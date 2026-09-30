"""Bounded combined shell output."""
import os
import threading

LIMIT = 5 * 1024 * 1024


class OutputLog:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.truncated = False
        with open(path, "wb"):
            pass

    def append(self, data):
        with self.lock:
            with open(self.path, "r+b") as stream:
                size = stream.seek(0, os.SEEK_END)
                if size + len(data) <= LIMIT:
                    stream.write(data)
                    return
                self.truncated = True
                keep = max(0, LIMIT - len(data))
                stream.seek(max(0, size - keep))
                tail = stream.read(keep) + data[-LIMIT:]
                stream.seek(0)
                stream.write(tail[-LIMIT:])
                stream.truncate()
