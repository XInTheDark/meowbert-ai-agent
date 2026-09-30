import base64
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server as workspace_server


class Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class DocumentLinkToolsTest(unittest.IsolatedAsyncioTestCase):
    async def test_registered_read_and_edit_tools_use_live_folder_link(self):
        calls = []
        metadata = {"id": "doc-1", "name": "Brief", "mimeType": "application/vnd.google-apps.document", "webViewLink": "https://docs.google.com/document/d/doc-1/edit"}

        def proxy(request, **_kwargs):
            payload = json.loads(request.data)
            calls.append(payload)
            if request.full_url.endswith("/resolve"):
                return Response({"reference": {
                    "itemId": "doc-1", "itemReference": "doc-1", "name": "Brief",
                    "mimeType": metadata["mimeType"], "webUrl": metadata["webViewLink"], "referenceToken": "folder-token",
                }})
            self.assertEqual(payload["referenceToken"], "folder-token")
            if payload["method"] == "POST":
                self.assertIn("/documents/doc-1:batchUpdate", payload["url"])
                body = json.loads(base64.b64decode(payload["bodyBase64"]))
                self.assertEqual(body["requests"][0]["replaceAllText"]["replaceText"], "After")
                content = {"documentId": "doc-1", "replies": [{"replaceAllText": {"occurrencesChanged": 1}}]}
            elif "docs.googleapis.com" in payload["url"]:
                content = {"documentId": "doc-1", "title": "Brief", "body": {"content": [{"paragraph": {"elements": [{"textRun": {"content": "Before\n"}}]}}]}}
            else:
                content = metadata
            return Response({"status": 200, "headers": {"content-type": "application/json"}, "bodyBase64": base64.b64encode(json.dumps(content).encode()).decode()})

        with tempfile.TemporaryDirectory() as task_dir:
            Path(task_dir, "Brief.url").write_text("[InternetShortcut]\r\nURL=https://docs.google.com/document/d/doc-1/edit\r\n")
            env = {"MEOWBERT_TASK_DIR": task_dir, "SOURCE_PROXY_BASE_URL": "https://api.example.test", "SOURCE_ID": "google-drive", "SOURCE_PROXY_TICKET": "ticket"}
            with patch.dict(os.environ, env, clear=True), patch("core.source_proxy.urlopen", side_effect=proxy):
                read = await workspace_server.mcp.call_tool("get_doc_content", {"document_id": "Brief.url"})
                self.assertIn("Before", str(read.content))
                edited = await workspace_server.mcp.call_tool("find_and_replace_doc", {"document_id": "Brief.url", "find_text": "Before", "replace_text": "After"})
                self.assertIn("Replaced 1", str(edited.content))
            self.assertEqual(sum("itemReference" in call for call in calls), 2)
            self.assertEqual(sum(call.get("method") == "POST" for call in calls), 1)


if __name__ == "__main__":
    unittest.main()
