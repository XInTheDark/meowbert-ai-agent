# Word documents

Create, edit, and visually review `.docx` files using the bundled `python-docx` library and LibreOffice rendering helper.

## Choose the format

- Prefer Word for general documents when no output format is specified, when the user needs an editable Office file, or when working with an existing Word document or template.
- When both Word and PDF copies are needed, export the same DOCX to PDF so their content and layout agree.
- For a new PDF-only report, proposal, guide, or handout, prefer the `typst` skill. Check `list_skills` and activate it with `enable_skill` (`{"skill": "typst"}`) before authoring.
- Use `html-canvas` for browser-based output, existing HTML, or layouts that are awkward to express with Word or Typst. Attractive typography, branding, and custom covers are also possible in document formats.

Follow the user's requested format and supplied template. These defaults help choose a workflow; they do not require rebuilding useful existing source.

## Create or edit

Use `python-docx` for structured creation and precise edits. Preserve existing styles, sections, headers, footers, and content outside the requested change. Define named styles for repeated formatting instead of styling every paragraph independently.

For template filling and placeholder edits, `docx-studio` provides dedicated tools; activate it when those tools fit the task. For a straightforward new document, Markdown through Pandoc with a styled `--reference-doc` can reduce authoring boilerplate. A Pandoc style reference is not a template-filling mechanism and should not replace a supplied document that must be preserved.

Keep tables readable at the final page size, use real headings and lists, and allow prose to flow naturally across pages. Add diagrams or callouts when they clarify content, without adding filler to decorate a page.

## Render and review

The sandbox bundles `python-docx`, `pdf2image`, and Poppler. LibreOffice is bundled when the Office build option is enabled. Use these dependencies directly; if a custom runtime lacks them, explain the missing capability rather than installing replacements during the task.

```bash
python3 /app/skills/openai-doc/scripts/render_docx.py report.docx --output_dir ./preview
```

Inspect the rendered pages for clipped text, broken tables, missing glyphs, awkward page breaks, and inconsistent spacing. After layout changes, render again and review the affected pages. Check the complete exported document before delivery.

For a PDF copy:

```bash
soffice --headless --convert-to pdf --outdir ./output report.docx
```

If rendering is unavailable, text extraction can still verify content, but it does not verify page layout. State that limitation.

## Deliver

Keep final documents in the task's output directory and previews separately. Deliver the editable DOCX and any requested PDF copy. Use fonts that cover the document's language and symbols, and keep citations readable without internal tool tokens or placeholders.
