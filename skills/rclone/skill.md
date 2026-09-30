Use this source when the workspace has connected an rclone remote.

Capabilities:
- Search rclone remote files and folders by filename or path.
- Browse the configured remote folder tree.
- Fetch a selected remote file to a destination path inside the task or workspace filesystem.

Notes:
- Search is implemented by recursively listing the configured remote path and matching names/paths.
- Item IDs are paths relative to the configured base directory.
- Prefer fetching only the files you actually need.
