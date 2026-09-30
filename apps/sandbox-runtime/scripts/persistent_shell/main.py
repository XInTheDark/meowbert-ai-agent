#!/usr/bin/env python3
"""Launch or contact the container-owned persistent shell supervisor."""
import base64
import json
import os
import socket
import subprocess
import sys
import time


def request(directory, payload):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(8)
        client.connect(os.path.join(directory, "control.sock"))
        client.sendall(json.dumps(payload).encode() + b"\n")
        with client.makefile("rb") as reader:
            return json.loads(reader.readline())


def main():
    action = sys.argv[1]
    payload = json.loads(base64.b64decode(sys.argv[2]))
    if action == "serve":
        from server import serve
        serve(payload)
    elif action == "launch":
        child = subprocess.Popen([sys.executable, __file__, "serve", sys.argv[2]],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("Persistent shell supervisor exited during startup")
            try:
                result = request(payload["directory"], {"action": "status"})
                print(json.dumps(result))
                return
            except (FileNotFoundError, ConnectionRefusedError):
                time.sleep(0.025)
        raise RuntimeError("Persistent shell supervisor did not become ready")
    else:
        print(json.dumps(request(payload.pop("directory"), payload)))


if __name__ == "__main__":
    main()
