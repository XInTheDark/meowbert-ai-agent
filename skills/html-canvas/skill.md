# Canvas

Use this skill for browser-based visual artifacts: interactive explanations, prototypes, dashboards, HTML slide decks, multi-page sites, and custom page compositions. You are working as the relevant expert for the medium (slide designer, prototyper, information designer, and so on), so avoid web-page conventions unless you are actually making a web page.

The HTML source is the editable source of truth. PNG and PDF files are review and delivery artifacts derived from it.

## Choose the format

- Prefer Word (`docx-studio` or `openai-doc`) for general documents with no specified format, editable Office output, and existing Word templates. Export the same Word document when a matching PDF is needed.
- For new PDF-only reports, proposals, guides, and handouts, prefer `typst`. Check `list_skills` and activate it with `enable_skill` (`{"skill": "typst"}`) before authoring. Branding, attractive typography, or a custom cover alone does not call for HTML.
- Use Canvas when the user requests HTML or interactive output, when reusing existing HTML, or when the composition is awkward to express with a document engine. For editable PowerPoint output, use a presentation skill.

These are defaults, not conversion requirements. Preserve the user's format choice and useful existing source. The page-oriented rules below apply after choosing Canvas, not to every document request.

## Design guide

Before you build an artifact or substantially restyle one, read `/app/skills/html-canvas/design-guide.md` in full and follow it. It covers the quality bar, what to settle before building, design principles, and format-specific guidance. Small edits within an existing design can skip it.

## Working with the user

- Look at what the user gave you before building: files, brand material, screenshots, existing artifacts, code. When adding to an existing design, follow its visual vocabulary (palette, type, density, copy tone, interaction states) rather than introducing your own.
- If the visual direction is genuinely open and there is no brand, reference, or existing work to follow, ask one short round of questions about audience, tone, and look before committing. Skip questions when the brief already answers them or the request is a small follow-up.
- Use text the user supplies verbatim. Format it well, but do not rewrite it unless asked.
- Do not pad. If an extra section, slide, or page would help, suggest it instead of adding it.
- When asked for a small, targeted change, change only that and leave everything else exactly as it was. If a broader change would help, finish the request and suggest the rest.
- For a significant revision or a new direction, copy the file first (`pitch.html` → `pitch-v2.html`) so the previous version survives.
- When asked for variations, prefer putting them side by side in one artifact with clear labels (`A`, `B`, `C`) so the user can compare and refer to them.
- Do not hand-draw illustrations or photos as SVG. Use the user's assets, generated images when the `image-generation` skill is available, or a plainly labeled placeholder that says what belongs there. Simple geometric shapes and real diagrams are fine.

## Structure

Pick the structure that matches the artifact:

- **Single page or interactive piece:** one HTML file.
- **Slide deck:** one HTML file built on `<meowbert-deck>`. Start from the `slide-deck` scaffold, which copies `meowbert-deck.js` beside the deck. Each slide is a `<section data-meowbert-page data-label="…" data-notes="…">` child of the deck. The component scales slides to the screen, handles keyboard navigation, an overview grid (G), speaker notes (N), and keeps the slide number in the URL. It also prints and renders one slide per page, so previews and PDF export need nothing extra. Do not position slides yourself, and do not split a deck into one file per slide unless the user asks.
- **Multi-page site or prototype:** separate HTML files in one folder, linked with relative `<a href="pricing.html">` links, sharing assets and CSS beside them. Show the entry page inline with `html_canvas_inline_file_artifact` (type `html`); the links and assets work inside the preview.
- **Paged document:** explicit page wrappers marked with `data-meowbert-page` (see the `report-pages` scaffold).

Implementation rules:

1. Prefer DOM and CSS layout over raw `<canvas>` drawing unless the task needs pixel-level painting.
2. Use flex or grid with `gap` to lay out groups of siblings; keep inline flow for running text.
3. Give pages and slides explicit dimensions, zero accidental body margins, and no unintended vertical spill.
4. Use shared CSS variables for repeated decisions so the system stays consistent. Define link colors from the palette even when there are no links yet.
5. Use relative asset paths and keep images, fonts, scripts, and other dependencies beside the source.
6. Keep text as real HTML text so PDFs stay selectable and searchable. Do not convert pages to screenshots before PDF export unless the user needs image-only pages.
7. Minimum sizes: slide text at 1920×1080 never below 24px, print text never below 12pt, touch targets on mobile layouts never below 44px.
8. For timed content (animations, video-like pieces), persist the playback position in `localStorage` and restore it on load.

## Canvas tools

- `html_canvas_scaffold`: copy a starter into the workspace. Use it when it saves time; one-off artifacts can start as purpose-built HTML.
  - `slide-deck`: single-file deck on `<meowbert-deck>`.
  - `report-pages`: explicit A4 page wrappers.
- `html_canvas_inline_artifact`: write an HTML document and show it in the conversation. Good for interactive demos, small reports, dashboards, and visual explanations.
- `html_canvas_inline_file_artifact`: show an existing task-local HTML, image, or Mermaid file in the conversation. Use this for decks and multi-file sites you have already written.
- `html_canvas_render`: render an HTML file or a directory into preview PNGs, `preview-index.html`, diagnostics, and an optional PDF. A single file captures each `[data-meowbert-page]` element as a page; a directory captures each HTML file as a page. Set `viewport_width`/`viewport_height` to the slide or page size, and use `create_pdf` once the previews look right.
- `scripts/html-canvas-cli.mjs`: CLI wrapper for shell-first scaffold and render workflows.

## Review

Render the artifact and look at the result before delivering it; good source code does not guarantee good pixels. Match the effort to the change: a copy or color tweak needs one look at the affected page, while a new deck or site deserves a pass over every page and the core interactions. For a long multi-page review, you can hand the inspection to a subagent (`spawn_subagent`, when available) with the preview paths and what to check, so the screenshots do not fill your own context. Use your judgment; it is not a required step.

Treat any `page_overflow_warnings` as a failed render, and treat `page_fit_adjustments` as a sign the source is too large for its page. Fix console errors, failed requests, and missing fonts or assets.

When reviewing, look in this order:

1. **Purpose and hierarchy.** The purpose is clear within five seconds, the first thing noticed is the right thing, and nothing is there only because the layout felt empty.
2. **Composition.** Margins, columns, and shared edges line up; related items sit closer than unrelated ones; nothing nearly touches by accident; empty space looks intentional.
3. **Typography and copy.** Line breaks in headings are deliberate, body text is readable at the final size, nothing is clipped or shrunk to fit, and redundant or decorative copy is gone.
4. **Visual system.** Colors, type roles, radii, borders, and icons follow one system. Remove cards, pills, badges, gradients, and glows that do not earn their place.
5. **Function.** The main interaction works at the intended viewport, and nothing overlaps, escapes the page, or disappears in PDF export.

Fix the problems you find in one coherent pass, then re-render what changed.

## PDF finishing

`pypdf` and `reportlab` are bundled for work around the HTML render path.

- Use `pypdf` to merge, split, reorder, rotate, delete, or copy pages; edit metadata; or apply an existing PDF overlay.
- Use `reportlab` for small PDF-only additions such as cover sheets, separators, barcodes, or overlays.
- Export a Canvas document from its HTML source with `html_canvas_render`; do not rebuild it in `reportlab`.

## Delivery

- Keep the editable HTML/CSS/JS and local assets with the final outputs, and deliver the latest reviewed version.
- Say which files were produced and which one is the editable source. Keep the summary short: caveats and sensible next steps, not a description of everything you did.
