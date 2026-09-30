import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.link_target import read_link_target
from core.reference_context import resolve_reference


class FolderReferencesTest(unittest.TestCase):
    def reference(self):
        return {
            "path": None, "itemId": "doc-1", "itemReference": "doc-1", "name": "Brief",
            "mimeType": "application/vnd.google-apps.document",
            "webUrl": "https://docs.google.com/document/d/doc-1/edit",
            "referenceToken": "signed-reference",
        }

    @patch("core.reference_context.request_source_proxy")
    def test_resolves_rclone_url_file_without_direct_attachment(self, request):
        request.return_value = {"reference": self.reference()}
        with tempfile.TemporaryDirectory() as task_dir:
            link = Path(task_dir, "Brief.url")
            link.write_text("[InternetShortcut]\r\nURL=https://docs.google.com/document/d/doc-1/edit?resourcekey=key-1\r\n")
            with patch.dict(os.environ, {"MEOWBERT_TASK_DIR": task_dir}, clear=True):
                self.assertEqual(resolve_reference("Brief.url", "docs").item_id, "doc-1")
        request.assert_called_once_with("resolve", {"itemReference": "doc-1::resourceKey::key-1"})

    @patch("core.reference_context.request_source_proxy")
    def test_resolves_newly_discovered_urls_and_ids_on_demand(self, request):
        request.return_value = {"reference": self.reference()}
        with patch.dict(os.environ, {}, clear=True):
            for target in ["doc-1", "https://docs.google.com/document/d/doc-1/edit"]:
                self.assertEqual(resolve_reference(target, "docs").reference_token, "signed-reference")
        self.assertEqual(request.call_count, 2)

    @patch("core.reference_context.request_source_proxy")
    def test_propagates_folder_revocation_and_checks_native_type(self, request):
        with patch.dict(os.environ, {}, clear=True):
            request.side_effect = RuntimeError("Folder detached")
            with self.assertRaisesRegex(RuntimeError, "Folder detached"):
                resolve_reference("doc-1", "docs")
            request.side_effect = None
            request.return_value = {"reference": self.reference()}
            with self.assertRaisesRegex(ValueError, "does not support the sheets tool"):
                resolve_reference("doc-1", "sheets")

    def test_ignores_non_google_and_oversized_links(self):
        with tempfile.TemporaryDirectory() as task_dir:
            link = Path(task_dir, "Brief.url")
            for content in [
                "[InternetShortcut]\nURL=https://example.com/document/d/doc-1/edit\n",
                "[InternetShortcut]\nURL=https://docs.google.com.evil.test/document/d/doc-1/edit\n",
                "[InternetShortcut]\nURL=https://docs.google.com/document/d/doc-1/edit\n" + "x" * 16_384,
            ]:
                link.write_text(content)
                self.assertIsNone(read_link_target(str(link)))


if __name__ == "__main__":
    unittest.main()
