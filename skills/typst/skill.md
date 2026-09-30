---
name: typst
description: Author PDF-only documents with automatic pagination, reusable styling, and editable Typst source.
---

# Typst

Use Typst for new PDF-only reports, proposals, guides, handouts, and technical documents. It handles flowing text, tables, figures, references, and page numbering while allowing custom page layouts. This skill provides guidance and a starter; run the bundled `typst` CLI through `run_shell`.

## Choose the source format

- For a general document with no requested format, prefer Word (`docx-studio` or `openai-doc`). Keep native DOCX when editing Word files or delivering matching Word and PDF copies.
- For a new PDF-only document, prefer Typst. A custom cover, branding, or attractive typography does not by itself require HTML.
- Use `html-canvas` for browser-based or interactive output, existing HTML, or visual compositions that are awkward to express with document layout. Keep existing LaTeX sources or required LaTeX templates in that format.
- For operations on an existing PDF, edit the PDF directly (for example with `pypdf` or `pymupdf`) instead of recreating its pages in Typst.

Use `list_skills` to find available skills and `enable_skill` with their ID when switching workflows. Respect the user's requested format, supplied template, and existing source.

## Author and compile

Write one flowing `.typ` source, splitting it into imports only when useful. Define styles once and let the engine paginate; avoid manually dividing prose into pages. Use semantic headings, figures, and tables so numbering and references remain meaningful.

The optional starter is a small, editable function, not a fixed layout. Copy it beside the document before importing it:

```bash
mkdir -p output/report
cp /app/skills/typst/templates/report.typ output/report/theme.typ
```

Create `output/report/report.typ`, for example:

```typst
#import "theme.typ": report
#show: report.with(title: "Project proposal", author: "Project team")

= Overview
Describe the proposal here.

= Scope
#table(
  columns: (1fr, 2fr),
  table.header([*Workstream*], [*Outcome*]),
  [Research], [A documented recommendation],
  [Delivery], [A reviewed implementation],
)
```

```bash
typst compile output/report/report.typ output/report/report.pdf
```

Typst and fonts are bundled in the sandbox image. The starter uses the compiler's embedded Libertinus Serif font and requires no external packages. Use `typst fonts` to check other fonts before choosing them. Keep images and any additional fonts beside the source; `--font-path` adds a local font directory. Imports and assets must be within the compilation root (by default the input file's directory).

The starter exposes paper size, margins, font families, font size, language, and accent color. Edit the copied function or write native Typst when more control is needed. For data-driven tables, load local JSON/CSV rather than repeating formatting for each row. There is no need to route Typst through Word, HTML, or a custom JSON document schema.

Use the installed compiler directly. If it is missing, report the sandbox image problem rather than installing an engine during the task. The starter works offline; avoid introducing downloadable packages when built-in features suffice.

## Layout and revision

- Use `set` and `show` rules for consistent styling, `grid` for composition, and `table.header` for headers that repeat across pages.
- Enable heading numbering (`#set heading(numbering: "1.")`) when using numbered heading references such as `@overview`; use a labeled link when an unnumbered reference is intended.
- Prefer flowing blocks to fixed heights for prose. Use explicit placement for covers or overlays with enough reserved space; overlays do not push surrounding text away.
- Long tables should be allowed to break across pages. If a table is wrapped in a figure, make its block breakable when needed.
- Typst's `columns` element does not automatically balance column heights. Irregular text wrapping around image contours can require another approach. Choose HTML when a concrete layout need warrants it, rather than treating every designed document as HTML work.

For unfamiliar features, read the relevant official reference: [styling](https://typst.app/docs/reference/styling/), [page setup](https://typst.app/docs/guides/page-setup/), [tables](https://typst.app/docs/guides/tables/), or [placement](https://typst.app/docs/reference/layout/place/). Match examples to the bundled compiler version reported by `typst --version`.

## Review and deliver

Render the exported PDF, so review covers the actual deliverable:

```bash
mkdir -p output/report/preview
pdftoppm -scale-to 1600 -png output/report/report.pdf output/report/preview/page
```

Inspect the page images for clipping, missing glyphs, table breaks, crowded margins, and unwanted blank pages. Fix the source and recompile affected output before delivery. Check references and selectable text with `view_pdf_file` or `pdftotext` as appropriate.

Deliver the PDF and retain the editable `.typ` source, copied theme, and local assets together. Keep review images separate from final deliverables. A PDF export does not produce a Word-editable document; if Word is needed, use the Word workflow from the start.
