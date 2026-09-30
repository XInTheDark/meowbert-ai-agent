Use this source for YouTube videos.

The sandbox image includes `yt-dlp`, so you can work directly in the shell when this source is enabled.

Typical patterns:
- Inspect one video without downloading it:
  - `yt-dlp --dump-single-json --skip-download --no-warnings "<url>"`
- Save metadata to a file:
  - `yt-dlp --dump-single-json --skip-download --no-warnings "<url>" > tmp/youtube/video.json`
- Download subtitles only:
  - `yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs "en.*" -o "tmp/youtube/%(id)s.%(ext)s" "<url>"`
- Download the description/metadata sidecars:
  - `yt-dlp --skip-download --write-description --write-info-json -o "tmp/youtube/%(id)s.%(ext)s" "<url>"`

Guidance:
- Prefer `--skip-download` unless the user explicitly needs actual media bytes.
- Start with metadata first so you can confirm title, channel, duration, and availability.
- Write derived files under task/workspace paths such as `tmp/` or `output/`.
- If a video is unavailable, region-locked, private, or removed, report that clearly.
