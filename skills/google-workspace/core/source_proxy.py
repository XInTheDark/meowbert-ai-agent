import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def request_source_proxy(operation: str, payload: dict) -> dict:
    base_url = os.environ.get("SOURCE_PROXY_BASE_URL", "").rstrip("/")
    source_id = os.environ.get("SOURCE_ID", "")
    ticket = os.environ.get("SOURCE_PROXY_TICKET", "")
    if not base_url or not source_id or not ticket:
        raise RuntimeError("Google Workspace Source proxy runtime is unavailable.")

    request = Request(
        f"{base_url}/api/internal/sources/{source_id}/google-workspace/{operation}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "authorization": f"Bearer {ticket}",
            "content-type": "application/json",
            "user-agent": "Meowbert-Google-Workspace/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(detail or f"Source proxy returned HTTP {error.code}.") from error
