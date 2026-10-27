# Canvas starters

Use a starter when it fits the medium. Replace sample content and follow the user's visual language; the starter is a layout aid, not a mandatory design.

- `document`: a flowing document with companion `meowbert-document.js`. Use `<meowbert-document mode="flow" paper="a4">` for prose; onscreen it is continuous, and Chromium paginates the PDF. Use `paper="letter"` or `paper="legal"` when needed.
- For composed documents, use the same component with `mode="pages"` and one `<section data-meowbert-page data-label="…">` child per page. Keep content within its page and inspect every page. A continuous screen view does not preview PDF page breaks.
- `report-pages`: the existing explicit A4 report layout.
- `slide-deck`: the existing scaled deck with navigation, overview, notes, and one slide per printed page.
- `prototype`: a browser frame plus `meowbert-starters.css`. Reuse `.browser-frame` with `.browser-bar`, or `.device-frame` with `.device-screen`. These are ordinary HTML/CSS containers. `.image-placeholder` visibly describes a missing image; replace it with a real image when supplied.
- `animation`: a CSS animation with Replay and reduced-motion support. Live Canvas runs animations normally. Static captures freeze finite animations near their final frame and loops at the end of their first cycle. For a JavaScript timeline, expose the intended static frame before setting `window.__MEOWBERT_READY__ = true`.

Set `data-meowbert-kind="document"`, `"slides"`, or `"web"` on `<html>` to identify the medium. Documents using `meowbert-document` offer Fit and 100% viewing; web prototypes retain responsive-width controls. Keep useful `data-meowbert-id` identifiers stable across revisions so selections and saved comments remain easy to locate.

For document rendering, use `layout="single"` for continuous prose and `layout="pages"` for explicit page wrappers. Export PDF from the same source. `html_canvas_export_html` (or CLI `export-html`) inlines local CSS, classic scripts, images, and fonts into a separate portable HTML file. Copy dependencies into the document folder first; bundle module scripts and flatten embedded documents or responsive srcset before export. Arbitrary JavaScript fetches and external page links are not bundled. Open the standalone file to verify it independently.
