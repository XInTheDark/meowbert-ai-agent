import json
import os
import unittest
from unittest.mock import patch

from core.proxy_http import MeowbertProxyHttp


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({
            "status": 200,
            "headers": {"content-type": "application/json"},
            "bodyBase64": "e30=",
        }).encode("utf-8")


class MeowbertProxyHttpTest(unittest.TestCase):
    @patch("core.source_proxy.urlopen", return_value=FakeResponse())
    def test_internal_proxy_request_uses_explicit_user_agent(self, urlopen_mock):
        env = {
            "SOURCE_PROXY_BASE_URL": "https://api.example.com",
            "SOURCE_ID": "google-drive",
            "SOURCE_PROXY_TICKET": "ticket",
        }
        with patch.dict(os.environ, env, clear=True):
            MeowbertProxyHttp("reference-token").request(
                "https://docs.googleapis.com/v1/documents/document-id"
            )

        request = urlopen_mock.call_args.args[0]
        self.assertEqual(
            request.get_header("User-agent"),
            "Meowbert-Google-Workspace/1.0",
        )


if __name__ == "__main__":
    unittest.main()
