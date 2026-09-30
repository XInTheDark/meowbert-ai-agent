"""Persistent Bash with command control independent of program input."""
import fcntl
import os
import pty
import signal
import struct
import subprocess
import termios
import threading


class ShellProcess:
    def __init__(self, directory, mode, cwd, on_done, on_exit, output):
        self.directory = directory
        self.mode = mode
        self.input_fd = None
        self.master = None
        self.ready = threading.Event()
        command_read, self.command_write = os.pipe()
        self.done_read, done_write = os.pipe()
        self.done_write_number = done_write
        script = os.path.join(directory, "shell.sh")
        with open(script, "w") as stream:
            stream.write(f'''trap ':' INT
set -m
while IFS= read -r __meowbert_file <&{command_read}; do
  source "$__meowbert_file"
  __meowbert_exit=$?
  printf '%s\\0%s\\0' "$__meowbert_exit" "$PWD" >&{done_write}
done
''')
        stdin, stdout, stderr = subprocess.DEVNULL, subprocess.PIPE, subprocess.STDOUT
        if mode == "terminal":
            self.master, slave = pty.openpty()
            self.resize(120, 40)
            stdin = stdout = stderr = slave

        def prepare():
            os.setsid()
            if mode == "terminal":
                fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        self.child = subprocess.Popen(
            ["/bin/bash", "--noprofile", "--norc", script], cwd=cwd,
            stdin=stdin, stdout=stdout, stderr=stderr,
            pass_fds=(command_read, done_write), preexec_fn=prepare)
        os.close(command_read)
        os.close(done_write)
        if mode == "terminal":
            os.close(slave)
            os.set_blocking(self.master, False)
        output_fd = self.master if mode == "terminal" else self.child.stdout.fileno()
        threading.Thread(target=self._drain, args=(output_fd, output), daemon=True).start()
        threading.Thread(target=self._completions, args=(on_done,), daemon=True).start()
        threading.Thread(target=lambda: on_exit(self.child.wait()), daemon=True).start()

    def _drain(self, descriptor, output):
        import select
        while True:
            try:
                select.select([descriptor], [], [])
                chunk = os.read(descriptor, 65536)
                if not chunk:
                    return
                output.append(chunk)
            except BlockingIOError:
                continue
            except OSError:
                return

    def _completions(self, callback):
        pending = b""
        while True:
            chunk = os.read(self.done_read, 4096)
            if not chunk:
                return
            pending += chunk
            while pending.count(b"\0") >= 2:
                code, cwd, pending = pending.split(b"\0", 2)
                if code == b"ready":
                    self.ready.set()
                else:
                    callback(int(code), os.fsdecode(cwd))

    def submit(self, command_id, command):
        import shlex
        self.close_input()
        self.ready.clear()
        target = os.path.join(self.directory, command_id + ".sh")
        with open(target, "w") as stream:
            stream.write(command + "\n")
        wrapper = os.path.join(self.directory, "command.sh")
        with open(wrapper, "w") as stream:
            line = "{ printf 'ready\\0\\0' >&" + str(self.done_write_number) + "; source " + shlex.quote(target) + "; }"
            if self.mode == "pipe":
                fifo = os.path.join(self.directory, command_id + ".stdin")
                os.mkfifo(fifo, 0o600)
                self.input_fd = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
                line += " < " + shlex.quote(fifo)
            stream.write(line + "\n")
        os.write(self.command_write, os.fsencode(wrapper) + b"\n")
        if not self.ready.wait(5):
            raise RuntimeError("Shell did not accept the command; inspect status before retrying")

    def close_input(self):
        if self.input_fd is not None:
            os.close(self.input_fd)
            self.input_fd = None

    def resize(self, cols, rows):
        if self.master is None:
            raise ValueError("resize requires terminal mode")
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def interrupt(self):
        if self.master is not None:
            group = os.tcgetpgrp(self.master)
            # Bash must receive SIGINT too so its trap handles the interrupted source.
            if group != self.child.pid:
                os.kill(self.child.pid, signal.SIGINT)
            os.killpg(group, signal.SIGINT)
        else:
            # Bash job control gives each pipeline its own process group.
            result = subprocess.run(["ps", "-eo", "pid=,ppid=,pgid="], capture_output=True, text=True, check=True)
            groups = {int(parts[2]) for row in result.stdout.splitlines()
                      if len(parts := row.split()) == 3 and int(parts[1]) == self.child.pid}
            for group in groups:
                try:
                    os.killpg(group, signal.SIGINT)
                except ProcessLookupError:
                    pass
            os.kill(self.child.pid, signal.SIGINT)
