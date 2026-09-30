# DOCX Studio

Create and edit Word documents with templates, embedded figures, PDF previews, and targeted text edits.

## Choose the format

- Prefer Word for general documents with no specified format, editable Office deliverables, and existing Word documents or templates. Export the same DOCX when a matching PDF copy is also needed.
- For a new PDF-only report, proposal, guide, or handout, prefer `typst`. Check `list_skills` and activate it with `enable_skill` (`{"skill": "typst"}`) before authoring.
- Use `html-canvas` for browser-based output, existing HTML, or layouts awkward to express with Word or Typst. A request for polished design alone does not require HTML.

Respect the requested format and existing source. The tools below are conveniences; their presets do not limit what a Word document can express. For custom layouts outside the creation tool's schema, use native DOCX authoring (the `openai-doc` workflow when available).

## Workflow

1. Start from the supplied document or template when there is one. Use `docx_find_templates` and `docx_get_template` when an external template would help; a new document does not require a template search.
2. Call `docx_inspect_placeholders` before filling an existing template.
3. For generated reports, call `docx_draw_figure_svg` when a section needs a visual, then pass that file into `docx_create_styled_document` with `visual_svg_path`, or let `docx_create_styled_document` generate visuals inline from a `visual` object.
4. Choose section `layout` values such as `body`, `summary`, `callout`, and `quote` to fit the content; variety is not a goal by itself.
5. Use `docx_render_pdf` to export the whole file or a page range to PDF, then inspect it with `view_pdf_file`.
6. Use `docx_replace_text`, `docx_fill_template`, or `docx_patch_tokens` depending on whether you need literal edits, templating, or placeholder-driven patching.

## Design presets

- `modern-report`
- `executive-brief`
- `academic-clean`

## Visual kinds

- `process`
- `roadmap`
- `comparison`
- `scorecard`
- `architecture`
- `ecosystem`

Read `references/aesthetic-presets.md` before generating production documents.

## Section layouts

- `body`
- `summary`
- `callout`
- `quote`

## Path conventions

- Prefer absolute file paths for `template_path`, `output_path`, and `visual_svg_path`.
- Relative paths resolve from this skill directory.

## Preview requirements

- In the default Meowbert sandbox runtime image, `docx_render_pdf` uses bundled LibreOffice when `skills.office.enabled` is `true` at build time.
- In custom runtimes, expose `soffice`/`libreoffice` or set `LIBREOFFICE_BIN`.
