# PPTX Studio

Use this skill to create richer presentation decks with reusable templates, built-in SVG visuals, preview-friendly PDF rendering, and lightweight editing workflows.

## Workflow

1. If you need a starting point, call `pptx_find_templates` and then `pptx_get_template`.
2. Call `pptx_inspect_placeholders` before filling an existing template.
3. For generated decks, call `pptx_draw_slide_svg` when a slide needs a diagram, then pass that file into `pptx_create_styled_deck` with `visual_svg_path`, or let `pptx_create_styled_deck` generate visuals inline from a `visual` object.
4. Use slide `layout` values like `balanced`, `visual-focus`, `metrics-grid`, `section-break`, and `quote` to avoid one-note decks.
5. Use `pptx_render_pdf` to export the whole deck or a slide range to PDF, then inspect it with `view_pdf_file`.
6. Use `pptx_replace_text` for literal text edits when you need to revise an existing deck without rebuilding it from scratch.

## Design presets

- `modern-product`
- `investor-clean`
- `academic-minimal`

## Visual kinds

- `process`
- `roadmap`
- `comparison`
- `scorecard`
- `architecture`
- `ecosystem`

Read `references/aesthetic-presets.md` before generating production slides.

## Slide layouts

- `balanced`
- `visual-focus`
- `metrics-grid`
- `section-break`
- `quote`

## Path conventions

- Prefer absolute file paths for `template_path`, `output_path`, and `visual_svg_path`.
- Relative paths resolve from this skill directory.

## Preview requirements

- In the default Meowbert sandbox runtime image, `pptx_render_pdf` uses bundled LibreOffice when `skills.office.enabled` is `true` at build time.
- In custom runtimes, expose `soffice`/`libreoffice` or set `LIBREOFFICE_BIN`.
