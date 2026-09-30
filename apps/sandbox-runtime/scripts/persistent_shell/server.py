"""Serialized local control protocol for one persistent shell."""
import json
import os
import select
import socket
import threading
import time
import uuid

from output import OutputLog
from process import ShellProcess


class Session:
    def __init__(self, config):
        self.lock = threading.RLock()
        self.directory = config["directory"]
        os.makedirs(self.directory, mode=0o700, exist_ok=True)
        self.output = OutputLog(config["logPath"])
        self.state = dict(status="idle", mode=config["mode"], commandId=None,
                          command="", exitCode=None, cwd=config["cwd"])
        self.shell = ShellProcess(self.directory, config["mode"], config["cwd"],
                                  self.completed, self.exited, self.output)
        self.persist()

    def persist(self):
        target = os.path.join(self.directory, "state.json")
        with open(target + ".tmp", "w") as stream:
            json.dump(self.state, stream)
        os.replace(target + ".tmp", target)

    def completed(self, code, cwd):
        with self.lock:
            if self.state["status"] != "running":
                return
            self.shell.close_input()
            self.state.update(status="idle", exitCode=code, cwd=cwd)
            self.persist()
            self.cleanup_command()

    def cleanup_command(self):
        command_id = self.state["commandId"]
        if command_id:
            for suffix in (".sh", ".stdin"):
                try:
                    os.unlink(os.path.join(self.directory, command_id + suffix))
                except FileNotFoundError:
                    pass

    def exited(self, code):
        with self.lock:
            self.state.update(status="completed", exitCode=code)
            self.persist()

    def snapshot(self):
        return {**self.state, "outputTruncated": self.output.truncated}

    def require_command(self, request):
        if self.state["status"] != "running":
            raise ValueError("No command is running in this session")
        if request.get("commandId") != self.state["commandId"]:
            raise ValueError("The active command changed; inspect status before sending input")

    def write(self, data):
        if len(data) > 65536:
            raise ValueError("Input must not exceed 64 KiB")
        descriptor = self.shell.master if self.state["mode"] == "terminal" else self.shell.input_fd
        if descriptor is None:
            raise ValueError("Command stdin is closed")
        deadline, accepted = time.monotonic() + 5, 0
        while accepted < len(data):
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([], [descriptor], [], max(0, remaining))[1]:
                return {"bytesAccepted": accepted, "complete": False}
            try:
                accepted += os.write(descriptor, data[accepted:])
            except BlockingIOError:
                continue
            except OSError:
                return {"bytesAccepted": accepted, "complete": False}
        return {"bytesAccepted": accepted, "complete": True}

    def handle(self, request):
        with self.lock:
            action = request["action"]
            if action == "status":
                return self.snapshot()
            if action == "submit":
                if self.state["status"] != "idle":
                    raise ValueError("Session is not idle; interrupt its command or start another session")
                command_id = str(uuid.uuid4())
                self.state.update(status="running", commandId=command_id,
                                  command=request["command"], exitCode=None)
                self.persist()
                self.shell.submit(command_id, request["command"])
                return self.snapshot()
            if action == "resize":
                cols, rows = request["cols"], request["rows"]
                if not (1 <= cols <= 1000 and 1 <= rows <= 1000):
                    raise ValueError("Terminal dimensions must be between 1 and 1000")
                self.shell.resize(cols, rows)
                return self.snapshot()
            self.require_command(request)
            if action == "input":
                return {**self.snapshot(), **self.write(request["data"].encode("utf-8"))}
            if action == "interrupt":
                self.shell.interrupt()
            elif action == "eof":
                if self.state["mode"] == "terminal":
                    return {**self.snapshot(), **self.write(b"\x04")}
                self.shell.close_input()
            else:
                raise ValueError("Unknown session action")
            return self.snapshot()


def serve(config):
    session = Session(config)
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(os.path.join(config["directory"], "control.sock"))
    os.chmod(os.path.join(config["directory"], "control.sock"), 0o600)
    listener.listen(16)
    while True:
        connection, _ = listener.accept()
        with connection:
            connection.settimeout(10)
            try:
                with connection.makefile("rb") as reader:
                    line = reader.readline(1024 * 1024 + 1)
                    if len(line) > 1024 * 1024:
                        raise ValueError("Session request is too large")
                    result = {"ok": True, "result": session.handle(json.loads(line))}
            except Exception as error:
                result = {"ok": False, "error": str(error)}
            try:
                connection.sendall(json.dumps(result).encode() + b"\n")
            except OSError:
                pass
