import asyncio
import functools
import io
import json
import logging
import ssl
import zipfile
from typing import Annotated, Any, List, Optional

from defusedxml import ElementTree as ET
from fastmcp.exceptions import ToolError
from googleapiclient.errors import HttpError
from pydantic import BeforeValidator


logger = logging.getLogger(__name__)
GOOGLE_API_WRITE_RETRIES = 3


class TransientNetworkError(Exception):
    pass


class UserInputError(Exception):
    pass


def _coerce_json_str_to_list(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value
    return parsed if isinstance(parsed, list) else value


StringList = Annotated[List[str], BeforeValidator(_coerce_json_str_to_list)]


def extract_office_xml_text(file_bytes: bytes, mime_type: str) -> Optional[str]:
    targets: list[str]
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            if mime_type.endswith("wordprocessingml.document"):
                targets = ["word/document.xml"]
            elif mime_type.endswith("presentationml.presentation"):
                targets = [name for name in archive.namelist() if name.startswith("ppt/slides/slide")]
            elif mime_type.endswith("spreadsheetml.sheet"):
                targets = [name for name in archive.namelist() if name.startswith("xl/worksheets/sheet")]
            else:
                return None
            values: list[str] = []
            for target in targets:
                root = ET.fromstring(archive.read(target))
                values.extend(
                    element.text.strip()
                    for element in root.iter()
                    if element.tag.endswith("}t") and element.text and element.text.strip()
                )
            text = "\n".join(values).strip()
            return text or None
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        return None


def handle_http_errors(
    tool_name: str, is_read_only: bool = False, service_type: Optional[str] = None
):
    del service_type

    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            max_attempts = 3 if is_read_only else 1
            for attempt in range(max_attempts):
                try:
                    return await func(*args, **kwargs)
                except ssl.SSLError as error:
                    if attempt + 1 >= max_attempts:
                        raise TransientNetworkError(
                            f"A transient SSL error occurred in '{tool_name}'."
                        ) from error
                    await asyncio.sleep(2**attempt)
                except (UserInputError, ToolError):
                    raise
                except HttpError as error:
                    raise Exception(f"Google API error in {tool_name}: {error}") from error
                except Exception as error:
                    logger.exception("Google Workspace tool failed: %s", tool_name)
                    raise Exception(
                        f"An unexpected error occurred in {tool_name}: {error}"
                    ) from error

        return wrapper

    return decorator
