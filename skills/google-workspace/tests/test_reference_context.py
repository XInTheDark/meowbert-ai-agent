import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.reference_context import resolve_reference


class ReferenceContextTest(unittest.TestCase):
    def test_resolves_project_allowlist_by_id_url_name_and_pointer_path(self):
        reference = {
            "path": None,
            "itemId": "doc-1",
            "itemReference": "doc-1",
            "name": "Project Brief",
            "mimeType": "application/vnd.google-apps.document",
            "webUrl": "https://docs.google.com/document/d/doc-1/edit",
            "referenceToken": "project-token",
        }
        with tempfile.TemporaryDirectory() as task_dir:
            pointer_path = Path(task_dir, "inputs", "Project Brief.gdoc")
            pointer_path.parent.mkdir(parents=True)
            pointer_path.write_text(json.dumps({"itemId": "doc-1"}), encoding="utf-8")
            env = {
                "MEOWBERT_TASK_DIR": task_dir,
                "GOOGLE_WORKSPACE_REFERENCES_JSON": json.dumps({
                    "references": [reference]
                }),
            }
            targets = [
                "doc-1",
                "https://docs.google.com/document/d/doc-1/edit",
                "Project Brief",
                "inputs/Project Brief.gdoc",
                str(pointer_path),
            ]
            with patch.dict(os.environ, env, clear=True):
                for target in targets:
                    with self.subTest(target=target):
                        self.assertEqual(
                            resolve_reference(target, "docs").item_id,
                            "doc-1",
                        )


if __name__ == "__main__":
    unittest.main()
