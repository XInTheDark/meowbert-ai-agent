Use this skill for Google Docs, Sheets, and Slides attached directly or contained in a live Google Drive folder attached to the current Project.

Important:
- The tools read and modify the original shared Google file immediately.
- Use an attached reference path, a live folder's `.url` path, a Google URL, or a Google file ID as the target. Directly attached files also accept their exact authorized name.
- Native Google files in live folders appear as small `.url` links. Pass the link path to these tools to read or edit the original; do not overwrite the link file. Access is checked against the attached folder on each request.
- Deleting a mounted `.url` entry removes the original Google file from Drive. Do not delete these entries as temporary shortcuts.
- Use `export_google_workspace_file` to create a DOCX, XLSX, or PPTX in the task filesystem when needed. Export is on demand and creates a separate snapshot; editing that snapshot does not update the Google original.
- Direct attachment adds a file to the current Project's persistent allowlist. All tasks in that Project can use it.
- A pointer or URL is not authorization by itself. The file must be directly attached or still inside a live folder attached to this Project.
- Read or inspect the file before index-based, range-based, or object-based edits.
- Prefer safer operations such as find-and-replace, append, and targeted range updates when they satisfy the request.
- If Google reports a concurrent edit or revision conflict, read the file again before retrying.
- Do not edit the `.gdoc`, `.gsheet`, or `.gslides` JSON file to change the Google document. The pointer file is only a signed reference.
- Use the Google Drive Source to search for or attach additional files.
