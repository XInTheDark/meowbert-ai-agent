Use this source when the workspace has connected Outlook.

Capabilities:
- Search and read email messages in the connected mailbox.
- List calendars and inspect calendar events over a time range.
- Safely create, update, and delete calendar events.

Safety notes:
- Calendar writes require explicit confirmation flags when attendees are involved.
- Event updates require the latest changeKey to avoid overwriting newer Outlook edits.
- Editing the body of an online meeting is blocked for safety because Outlook can remove the meeting join blob.
