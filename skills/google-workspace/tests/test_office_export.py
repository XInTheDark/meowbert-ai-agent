import base64
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import core.office_export  # noqa: F401
from core.server import mcp


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class OfficeExportTest(unittest.IsolatedAsyncioTestCase):
    async def test_exports_via_registered_tool_resolver_and_authenticated_proxy(self):
        formats = [
            ("application/vnd.google-apps.document", "docx", "word/document.xml"),
            ("application/vnd.google-apps.spreadsheet", "xlsx", "xl/workbook.xml"),
            ("application/vnd.google-apps.presentation", "pptx", "ppt/presentation.xml"),
        ]
        for native_mime, extension, member in formats:
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as task_dir:
                data = io.BytesIO()
                with zipfile.ZipFile(data, "w") as archive:
                    archive.writestr(member, "<document>Export fixture</document>")
                exported = data.getvalue()
                calls = []

                def proxy(request, **_kwargs):
                    payload = json.loads(request.data)
                    calls.append(payload)
                    self.assertEqual(request.get_header("Authorization"), "Bearer scoped-ticket")
                    if request.full_url.endswith("/resolve"):
                        return FakeResponse({"reference": {
                            "itemId": "file-1", "itemReference": "file-1", "name": "Notes",
                            "mimeType": native_mime, "webUrl": None, "referenceToken": "signed-token",
                        }})
                    self.assertEqual(payload["referenceToken"], "signed-token")
                    self.assertEqual(payload["method"], "GET")
                    is_export = "/export?" in payload["url"]
                    body = exported if is_export else json.dumps({"name": "Notes", "mimeType": native_mime}).encode()
                    return FakeResponse({"status": 200, "headers": {"content-type": "application/octet-stream" if is_export else "application/json"}, "bodyBase64": base64.b64encode(body).decode()})

                env = {"MEOWBERT_TASK_DIR": task_dir, "SOURCE_PROXY_BASE_URL": "https://api.example.test", "SOURCE_ID": "google-drive", "SOURCE_PROXY_TICKET": "scoped-ticket"}
                Path(task_dir, "Notes.url").write_text("[InternetShortcut]\nURL=https://docs.google.com/document/d/file-1/edit\n")
                with patch.dict(os.environ, env, clear=True), patch("core.source_proxy.urlopen", side_effect=proxy):
                    await mcp.call_tool("export_google_workspace_file", {"file_id": "Notes.url", "output_path": f"exports/Notes.{extension}"})
                    output = Path(task_dir, "exports", f"Notes.{extension}")
                    self.assertEqual(output.read_bytes(), exported)
                    with zipfile.ZipFile(output) as archive:
                        self.assertIn(member, archive.namelist())
                    self.assertEqual(len(calls), 3)
                    with self.assertRaisesRegex(Exception, "already exists"):
                        await mcp.call_tool("export_google_workspace_file", {"file_id": "Notes.url", "output_path": f"exports/Notes.{extension}"})
                    self.assertEqual(output.read_bytes(), exported)


if __name__ == "__main__":
    unittest.main()
