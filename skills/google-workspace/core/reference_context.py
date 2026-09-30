import json
import os
from dataclasses import dataclass
from pathlib import Path
from core.link_target import google_item_reference, read_link_target, resolve_local_path
from core.source_proxy import request_source_proxy


SUPPORTED_MIME_TYPES = {
    "docs": "application/vnd.google-apps.document",
    "sheets": "application/vnd.google-apps.spreadsheet",
    "slides": "application/vnd.google-apps.presentation",
    "drive": None,
}


@dataclass(frozen=True)
class GoogleWorkspaceReference:
    path: str | None
    item_id: str
    item_reference: str
    name: str
    mime_type: str
    web_url: str | None
    reference_token: str


def _load_references() -> list[GoogleWorkspaceReference]:
    raw = os.environ.get("GOOGLE_WORKSPACE_REFERENCES_JSON", "")
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    entries = payload.get("references") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        return []

    references: list[GoogleWorkspaceReference] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if not all(
            isinstance(entry.get(key), str)
            for key in ("itemId", "itemReference", "name", "mimeType", "referenceToken")
        ):
            continue
        reference_path = entry.get("path")
        if reference_path is not None and not isinstance(reference_path, str):
            continue
        web_url = entry.get("webUrl")
        if web_url is not None and not isinstance(web_url, str):
            continue
        references.append(
            GoogleWorkspaceReference(
                path=reference_path,
                item_id=entry["itemId"],
                item_reference=entry["itemReference"],
                name=entry["name"],
                mime_type=entry["mimeType"],
                web_url=web_url,
                reference_token=entry["referenceToken"],
            )
        )
    return references


def _resolve_folder_reference(item_reference: str) -> GoogleWorkspaceReference:
    entry = request_source_proxy("resolve", {"itemReference": item_reference})["reference"]
    return GoogleWorkspaceReference(
        path=None,
        item_id=entry["itemId"],
        item_reference=entry["itemReference"],
        name=entry["name"],
        mime_type=entry["mimeType"],
        web_url=entry["webUrl"],
        reference_token=entry["referenceToken"],
    )


def resolve_reference(value: str, service_type: str) -> GoogleWorkspaceReference:
    references = _load_references()
    requested_path = str(resolve_local_path(value)) if value.strip() else ""
    item_reference = google_item_reference(value) or read_link_target(value)
    requested_id = item_reference.split("::resourceKey::", 1)[0] if item_reference else None
    requested_name = value.strip().casefold()
    matches = [
        reference
        for reference in references
        if (
            reference.path is not None
            and requested_path == str(Path(reference.path).expanduser().resolve())
        )
        or (requested_id is not None and requested_id == reference.item_id)
        or requested_name == reference.name.casefold()
    ]
    if not matches and item_reference:
        matches = [_resolve_folder_reference(item_reference)]
    if len(matches) != 1:
        raise ValueError(
            "No unique Google Workspace reference matches this target. "
            "Use an attached reference, a live folder's .url path, or a Google file URL or ID."
        )

    reference = matches[0]
    expected_mime = SUPPORTED_MIME_TYPES.get(service_type)
    if expected_mime and reference.mime_type != expected_mime:
        raise ValueError(
            f"The attached Google file type does not support the {service_type} tool."
        )
    return reference
