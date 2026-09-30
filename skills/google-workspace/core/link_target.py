import configparser
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def resolve_local_path(value: str) -> Path:
    candidate = Path(value).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    task_dir = os.environ.get("MEOWBERT_TASK_DIR", "")
    return Path(task_dir, candidate).resolve() if task_dir else candidate.resolve()


def google_item_reference(value: str) -> str | None:
    trimmed = value.strip()
    try:
        parsed = urlparse(trimmed)
    except ValueError:
        return None
    if parsed.scheme == "https" and parsed.hostname in {"drive.google.com", "docs.google.com"}:
        query = parse_qs(parsed.query)
        match = re.search(r"/d/([A-Za-z0-9_-]+)(?:/|$)", parsed.path)
        item_id = query.get("id", [None])[0] or (match.group(1) if match else None)
        resource_key = query.get("resourcekey", [None])[0]
        if item_id and re.fullmatch(r"[A-Za-z0-9_-]+", item_id):
            return f"{item_id}::resourceKey::{resource_key}" if resource_key else item_id
        return None
    return trimmed if re.fullmatch(r"[A-Za-z0-9_-]+(?:::resourceKey::[A-Za-z0-9_-]+)?", trimmed) else None


def read_link_target(value: str) -> str | None:
    pointer_path = resolve_local_path(value)
    if pointer_path.suffix.lower() not in {".gdoc", ".gsheet", ".gslides", ".url"}:
        return None
    try:
        with pointer_path.open(encoding="utf-8-sig") as handle:
            content = handle.read(16_385)
        if len(content) > 16_384:
            return None
        if pointer_path.suffix.lower() == ".url":
            config = configparser.ConfigParser(interpolation=None)
            config.read_string(content)
            return google_item_reference(config.get("InternetShortcut", "URL"))
        payload = json.loads(content)
        target = payload.get("itemReference") or payload.get("itemId") if isinstance(payload, dict) else None
        return google_item_reference(target) if isinstance(target, str) else None
    except (OSError, ValueError, configparser.Error):
        return None
