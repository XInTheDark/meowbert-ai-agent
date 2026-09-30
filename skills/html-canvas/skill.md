# Canvas

Use this skill for browser-based visual artifacts, interactive explanations, dashboards, HTML slide decks, and custom page compositions. Render the result locally before delivery.

The HTML source is the editable source of truth. PNG and PDF files are review and delivery artifacts derived from it.

## Choose the format

- Prefer Word (`docx-studio` or `openai-doc`) for general documents with no specified format, editable Office output, and existing Word templates. Export the same Word document when a matching PDF is needed.
- For new PDF-only reports, proposals, guides, and handouts, prefer `typst`. Check `list_skills` and activate it with `enable_skill` (`{"skill": "typst"}`) before authoring. Branding, attractive typography, or a custom cover alone does not call for HTML.
- Use Canvas when the user requests HTML or interactive output, when reusing existing HTML, or when the composition is awkward to express with a document engine. For editable PowerPoint output, use a presentation skill.

These are defaults, not conversion requirements. Preserve the user's format choice and useful existing source. The page-oriented rules below apply after choosing Canvas, not to every document request.

{{CANVAS_DESIGN_GUIDANCE}}
## Implementation rules

1. Prefer DOM and CSS layout over raw `<canvas>` drawing unless the task genuinely requires pixel-level painting.
2. For slide decks, storyboards, and other slide-like sets, default to one sortable HTML file per page (e.g., `01-cover.html`, `02-context.html`).
3. A single-file deck is also suitable when requested or when it makes the source easier to maintain; keep repeated styling shared.
4. When one HTML file genuinely contains multiple pages, use explicit wrappers marked with `data-meowbert-page`.
5. Give every page explicit dimensions, zero accidental body margins, and no unintended vertical spill.
6. Use semantic HTML and shared CSS variables or tokens so repeated decisions remain consistent.
7. Use relative asset paths. Keep images, fonts, scripts, and other dependencies beside the source and reference them with paths such as `./images/chart.png`.
8. Re-render after every meaningful visual change.
9. Keep text as normal HTML text when the PDF must remain selectable and searchable.
10. Do not convert pages to screenshots before PDF export unless the user explicitly needs image-only pages.

## Canvas tools

Use the primary Canvas tools by default:

- `html_canvas_scaffold`: Copy a bundled starter into the workspace. Use it only when a starter will save time; most one-off artifacts can begin as purpose-built HTML.
  - `slide-deck` is a fixed 16:9 slide starter.
  - `report-pages` provides explicit A4-style page wrappers.
- `html_canvas_inline_artifact`: Save and display an HTML document directly in the conversation. Use it for interactive demos, small reports, dashboards, visual explanations, and other artifacts the user benefits from seeing immediately.
- `html_canvas_inline_file_artifact`: Display an existing task-local image or Mermaid file inline.
- `html_canvas_render`: Render an HTML file or directory into preview PNGs, `preview-index.html`, diagnostics, and an optional PDF.
  - Directory input renders `.html` and `.htm` files alphabetically, one file per output page.
  - Use `orientation: "landscape"` when the output should be wide.
  - Use `create_pdf` after inspecting the preview and fixing visible layout problems.
- `scripts/html-canvas-cli.mjs`: Use the local CLI wrapper for shell-first scaffold and render workflows.

Both bundled templates set `window.__MEOWBERT_READY__ = true` and mark their pages with `data-meowbert-page`.

## Rendering workflow

1. Author the complete first version in HTML/CSS/JS.
2. Render it with `html_canvas_render` to a dedicated output directory.
3. Inspect every generated PNG, not only the HTML source or renderer diagnostics.
4. Open `preview-index.html` to scan a multi-page artifact as a set.
5. Review at the intended output size. Also inspect multi-page work at thumbnail scale to judge rhythm, repetition, and hierarchy.
6. Test the real interaction in the browser at the target viewport before finalizing.
7. Fix all visible problems in one coherent pass.
8. Re-render and perform a final confirmation pass before delivery.
9. Export the PDF from the same HTML source only after the latest previews pass review.

## Visual review checklist

Review the rendered pixels in this strict order.

### 1. Purpose and hierarchy

- Is the artifact's purpose apparent within five seconds?
- Is the first thing the viewer notices the right thing?
- Is the reading order clear without explanation?
- Does each page or region have one primary responsibility?
- Is anything present only because the layout felt empty? (If yes, delete it).

### 2. Composition and alignment

- Check outer margins, columns, gutters, shared edges, baselines, centers, and repeated offsets.
- Look for elements that are almost aligned but visibly drift.
- Check optical centering, not only mathematical centering, especially for icons and asymmetric shapes.
- Look for accidental tangencies: objects nearly touching, borders colliding, text grazing shapes, or unrelated elements forming misleading lines.
- Confirm that visual weight is balanced and that empty space feels intentional, not like a forgotten gap.
- Confirm that related items are closer to each other than to unrelated items.

### 3. Typography and copy

- Check every line break in titles, headings, labels, and callouts.
- Check body measure, line height, contrast, and readable size at the final scale.
- **Aggressively remove** redundant, vague, artificial, or decorative copy.
- Check capitalization, punctuation, terminology, and number formatting for consistency.
- Confirm that no text is clipped, crowded, orphaned, or made tiny to fit.

### 4. Visual system

- Check that colors, type roles, radii, borders, shadows, icon treatment, and spacing follow one coherent system.
- **Deslop check:** Remove unnecessary cards, feature pills, badges, gradients, glows, and decorative widgets. Ensure it does not look like a generic AI template.
- Confirm that imagery, charts, and diagrams support the content and use consistent treatment.

### 5. Function and rendering

- Test the core interaction where applicable.
- Check the intended viewport and any required responsive sizes.
- Fix missing assets, missing fonts, failed requests, JavaScript errors, and console errors.
- Treat any `page_overflow_warnings` as a failed render.
- Treat `page_fit_adjustments` as evidence that the source is too large for the target page; tighten the source rather than relying on automatic fitting.
- Confirm that nothing falls outside the canvas, overlaps unintentionally, or becomes obscured during PDF export.

Do not deliver when the artifact is merely "complete" in code. Deliver when the rendered result is coherent, readable, correctly aligned, aggressively freed of decorative clutter, and visibly checked for human use.

## PDF finishing

`pypdf` and `reportlab` are bundled for work around the HTML render path.

- Use `pypdf` to merge, split, reorder, rotate, delete, or copy pages; edit metadata; or apply an existing PDF overlay.
- Use `reportlab` to generate deterministic PDF-only material such as cover sheets, separators, appendix pages, barcodes, simple tables, or overlays.
- Prefer `pypdf` when modifying or assembling existing PDFs.
- For a document already authored in Canvas, export from that source with `html_canvas_render`; use the format guidance above when starting a new document.
- Do not rebuild the main document in `reportlab` when the HTML already expresses it well.
- Keep the HTML source beside the exported assets and explain any necessary PDF post-processing.

## Delivery

- Keep the editable HTML/CSS/JS and local assets with the final outputs.
- Deliver the latest reviewed artifact, not an earlier export.
- State what files were produced and identify the editable source.
- Mention any intentional limitation that remains visible in the final result.
