"""Real process and reconnect tests; also run inside the sandbox image."""
import base64
import json
import os
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from main import request


class RuntimeTests(unittest.TestCase):
    def start(self, mode):
        self.temp = tempfile.TemporaryDirectory(prefix="mb-")
        self.addCleanup(self.temp.cleanup)
        self.directory = self.temp.name
        self.log = Path(self.directory) / "output.log"
        config = dict(directory=self.directory, mode=mode, cwd=self.directory, logPath=str(self.log))
        payload = base64.b64encode(json.dumps(config).encode()).decode()
        self.process = subprocess.Popen(["python3", str(Path(__file__).with_name("main.py")), "serve", payload],
                                        start_new_session=True, stderr=subprocess.PIPE)
        self.addCleanup(self.stop)
        for _ in range(200):
            if Path(self.directory, "control.sock").exists():
                return
            if self.process.poll() is not None:
                self.fail(self.process.stderr.read().decode())
            time.sleep(.025)
        self.fail("Supervisor did not start")

    def stop(self):
        # The shell has its own session; explicitly terminate its descendants in tests.
        listing = subprocess.check_output(["ps", "-eo", "pid=,ppid="], text=True)
        descendants = {self.process.pid}
        for _ in range(20):
            found = {int(row.split()[0]) for row in listing.splitlines()
                     if int(row.split()[1]) in descendants}
            if found.issubset(descendants):
                break
            descendants.update(found)
        for pid in sorted(descendants - {self.process.pid}, reverse=True):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.process.kill()
        self.process.wait()
        self.process.stderr.close()

    def call(self, action, **kwargs):
        result = request(self.directory, dict(action=action, **kwargs))
        self.assertTrue(result["ok"], result)
        return result["result"]

    def idle(self):
        for _ in range(200):
            state = self.call("status")
            if state["status"] != "running":
                return state
            time.sleep(.025)
        self.fail("Command did not finish: " + self.log.read_text(errors="replace"))

    def output(self, text):
        for _ in range(200):
            if text in self.log.read_text(errors="replace"):
                return
            time.sleep(.025)
        self.fail("Missing output: " + repr(text) + " in " + self.log.read_text(errors="replace")[-1000:])

    def test_pipe_state_input_eof_and_reconnect(self):
        self.start("pipe")
        self.call("submit", command="mkdir nested; cd nested; export SAVED=yes; local_var=present")
        self.assertEqual(self.idle()["cwd"], os.path.realpath(self.directory) + "/nested")
        command = self.call("submit", command="printf '%s %s\\n' \"$SAVED\" \"$local_var\"; cat")
        self.call("input", commandId=command["commandId"], data="exact input\n")
        self.call("eof", commandId=command["commandId"])
        self.assertEqual(self.idle()["status"], "idle")
        self.output("yes present\nexact input\n")
        self.call("submit", command="printf 'after eof\\n'")
        self.idle()
        self.output("after eof")

    def test_terminal_read_interrupt_resize_and_exit(self):
        self.start("terminal")
        self.call("resize", cols=90, rows=30)
        command = self.call("submit", command="read -r answer; printf 'answer=%s\\n' \"$answer\"; stty size")
        self.call("input", commandId=command["commandId"], data="hello\n")
        self.assertEqual(self.idle()["status"], "idle")
        self.output("answer=hello")
        self.output("30 90")
        command = self.call("submit", command="saved_before_interrupt=yes; sleep 60")
        time.sleep(.15)
        self.call("interrupt", commandId=command["commandId"])
        self.assertEqual(self.idle()["status"], "idle")
        self.call("submit", command="printf 'preserved=%s\\n' \"$saved_before_interrupt\"")
        self.assertEqual(self.idle()["status"], "idle")
        self.output("preserved=yes")
        self.call("submit", command="exit 7")
        self.assertEqual(self.idle()["exitCode"], 7)

    def test_rolling_output_and_stale_input(self):
        self.start("pipe")
        old = self.call("submit", command="python3 -c 'import sys; sys.stdout.write(\"x\" * 6000000); print(\"LATEST\")'")
        self.idle()
        self.output("LATEST")
        self.assertLessEqual(self.log.stat().st_size, 5 * 1024 * 1024)
        self.assertTrue(self.call("status")["outputTruncated"])
        new = self.call("submit", command="cat")
        rejected = request(self.directory, dict(action="input", commandId=old["commandId"], data="bad"))
        self.assertFalse(rejected["ok"])
        self.call("input", commandId=new["commandId"], data="good")
        self.call("eof", commandId=new["commandId"])
        self.idle()
        self.output("good")

    def test_terminal_python_repl(self):
        self.start("terminal")
        command = self.call("submit", command="python3 -q")
        self.output(">>>")
        self.call("input", commandId=command["commandId"], data="print(6 * 7)\n")
        self.output("42")
        self.call("input", commandId=command["commandId"], data="exit()\n")
        self.assertEqual(self.idle()["status"], "idle")
        self.call("submit", command="printf 'shell survived\\n'")
        self.idle()
        self.output("shell survived")

    def test_terminal_eof(self):
        self.start("terminal")
        command = self.call("submit", command="cat")
        self.call("input", commandId=command["commandId"], data="line\n")
        self.output("line")
        self.call("eof", commandId=command["commandId"])
        self.assertEqual(self.idle()["exitCode"], 0)

    def test_pipe_read_and_immediate_eof(self):
        self.start("pipe")
        for _ in range(5):
            command = self.call("submit", command="read -r answer; printf '<%s>' \"$answer\"")
            self.call("input", commandId=command["commandId"], data="it's exact\n")
            self.assertEqual(self.idle()["exitCode"], 0)
        self.output("<it's exact>" * 5)
        command = self.call("submit", command="cat")
        self.call("eof", commandId=command["commandId"])
        self.assertEqual(self.idle()["exitCode"], 0)

    def test_pipe_interrupt_and_busy_submission(self):
        self.start("pipe")
        command = self.call("submit", command="sleep 60")
        time.sleep(.1)
        self.assertFalse(request(self.directory, dict(action="submit", command="echo wrong"))["ok"])
        self.call("interrupt", commandId=command["commandId"])
        self.assertEqual(self.idle()["status"], "idle")
        self.call("submit", command="false")
        self.assertEqual(self.idle()["exitCode"], 1)
        self.assertFalse(request(self.directory, dict(action="resize", cols=80, rows=24))["ok"])

    def test_bounded_input_and_write_deadline(self):
        self.start("pipe")
        command = self.call("submit", command="sleep 60")
        self.assertFalse(request(self.directory, dict(action="input", commandId=command["commandId"], data="é" * 32769))["ok"])
        started = time.monotonic()
        result = self.call("input", commandId=command["commandId"], data="x" * 65536)
        # Linux may accept all 64 KiB; smaller pipe capacities return a partial acknowledgement.
        self.assertLess(time.monotonic() - started, 7)
        self.assertLessEqual(result["bytesAccepted"], 65536)
        self.assertEqual(result["complete"], result["bytesAccepted"] == 65536)

    def test_exec_ends_session_and_keeps_final_stderr(self):
        self.start("pipe")
        self.call("submit", command="printf 'final error\\n' >&2; exec python3 -c 'raise SystemExit(9)'")
        self.assertEqual(self.idle()["status"], "completed")
        self.assertEqual(self.call("status")["exitCode"], 9)
        self.output("final error")
        self.assertFalse(request(self.directory, dict(action="submit", command="echo forbidden"))["ok"])


if __name__ == "__main__":
    unittest.main()
