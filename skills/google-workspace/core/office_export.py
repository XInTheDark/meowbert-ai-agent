import asyncio
from auth.service_decorator import require_google_service
from core.link_target import resolve_local_path
from core.server import server


OFFICE_FORMATS = {
    "application/vnd.google-apps.document": (
        ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    "application/vnd.google-apps.spreadsheet": (
        ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),
    "application/vnd.google-apps.presentation": (
        ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ),
}


@server.tool()
@require_google_service("drive", [])
async def export_google_workspace_file(
    service, user_google_email: str, file_id: str, output_path: str
) -> str:
    """Export an attached Google Doc, Sheet, or Slides file to DOCX, XLSX, or PPTX.

    file_id accepts a Google URL, ID, attached reference, or live folder .url path.
    output_path is a new local file, relative to the task directory or absolute.
    This creates an Office snapshot; it does not change the original Google file.
    """
    del user_google_email
    metadata = await asyncio.to_thread(
        service.files().get(fileId=file_id, fields="name,mimeType", supportsAllDrives=True).execute
    )
    file_format = OFFICE_FORMATS.get(metadata.get("mimeType"))
    if file_format is None:
        raise ValueError("Only Google Docs, Sheets, and Slides can be exported to Office files.")
    extension, mime_type = file_format
    destination = resolve_local_path(output_path)
    if not output_path.strip() or destination.suffix.lower() != extension:
        raise ValueError(f"Choose an output path ending in {extension}.")
    if destination.exists():
        raise ValueError("The export destination already exists. Choose a new file path.")
    content = await asyncio.to_thread(
        service.files().export_media(fileId=file_id, mimeType=mime_type).execute
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("xb") as output:
        output.write(content)
    return f"Exported {metadata['name']} to {destination} ({len(content)} bytes). The original Google file is unchanged."
