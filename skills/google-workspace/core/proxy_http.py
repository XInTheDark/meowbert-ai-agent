import base64
import httplib2
from core.source_proxy import request_source_proxy


class MeowbertProxyHttp:
    def __init__(self, reference_token: str):
        self.reference_token = reference_token

    def request(
        self,
        uri: str,
        method: str = "GET",
        body: bytes | str | None = None,
        headers: dict[str, str] | None = None,
        **_kwargs,
    ):
        raw_body = body.encode("utf-8") if isinstance(body, str) else body
        payload = {
            "referenceToken": self.reference_token,
            "method": method.upper(),
            "url": uri,
            "headers": headers or {},
            "bodyBase64": base64.b64encode(raw_body).decode("ascii") if raw_body else None,
        }
        response_payload = request_source_proxy("request", payload)

        status = int(response_payload.get("status", 500))
        response_headers = {
            str(key).lower(): str(value)
            for key, value in (response_payload.get("headers") or {}).items()
        }
        response_headers["status"] = str(status)
        content = base64.b64decode(response_payload.get("bodyBase64") or "")
        return httplib2.Response(response_headers), content

    def close(self) -> None:
        return None
