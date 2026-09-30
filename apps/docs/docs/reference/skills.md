---
title: Skills Reference
summary: MCP-based tool packs that extend the agent with specialized capabilities.
---

# Skills Reference

Skills are **MCP (Model Context Protocol) tool packs** that extend the agent with capabilities beyond standard shell commands. When you enable a skill in the Task Composer, its tools become available to the agent during that task.

Stdio-based skills run inside the same sandbox container as the task's `run_shell` commands, so they share the task filesystem view and the project's sandbox network policy.

Some skills expose deterministic tools directly inside Meowbert (for example **DOCX Studio** and **PPTX Studio**). Others are **instruction-first workflows** that give the agent curated scripts, references, and validation steps for a specific kind of work (for example **OpenAI: doc** and **Guided Learning**).

Want to add your own? See [Custom Skills](/self-hosting/custom-skills).

Skills are defined in the `skills/` directory and loaded by the worker at startup. Each skill has a manifest (`skill.json`) and documentation (`skill.md`) shown to the agent when the skill is active.

---

## Choosing the right skill

- Use **DOCX Studio** for general documents, Word templates, and matching Word/PDF copies. **OpenAI: doc** provides flexible Python-based Word authoring and editing.
- Use **Typst** for new PDF-only reports, proposals, guides, and handouts with automatic pagination and editable source.
- Use **Canvas** for interactive visuals, HTML decks, existing HTML, or custom page compositions that benefit from browser layout. A polished report does not need to use HTML.
- Use **Guided Learning** when you want a concept taught in learner-sized steps with intuition, examples, understanding checks, and visual or interactive explanations where useful.
- Use **Image Generation** when you want an OpenAI-compatible image generation endpoint to create a new image and save it as a task file.
- Use **PPTX Studio** when you want deterministic PowerPoint tools for editable slide decks, branded templates, metric cards, and visuals.
- Use **Google Workspace** when a directly attached Google Doc, Sheet, or Slides presentation should be read or edited in its original shared location.

When no output format is specified, ordinary documents default to Word. Existing sources, supplied templates, and your explicit format choice take precedence. If both Word and PDF are requested, the PDF is exported from the Word document.

---

## Available Skills

### Browser Use

**ID:** `browser-use`
**Requires:** Super-admin installation

Automates web browsers using Playwright. Useful for tasks that need to interact with websites — filling forms, navigating pages, extracting content, or taking screenshots.

**Example use cases:**
- "Log into the admin panel and export the latest report."
- "Take a screenshot of the homepage on mobile viewport."
- "Fill in the registration form and confirm submission."

**How to enable:** First set `skills.browserUse.enabled: true` in your server config and rebuild the sandbox runtime image, then select **Browser Use** in the Skills selector in the Task Composer wrench menu.

> This skill is bundled and pinned in the sandbox runtime image when `skills.browserUse.enabled` is on, and is typically restricted to super-admin accounts. Browser Use now launches through a local wrapper that resolves the bundled Chromium executable path explicitly for more reliable startup inside the sandbox. Contact your server admin to enable it for your workspace.

---

### Canvas

**ID:** `html-canvas`

Creates browser-based visuals and custom page compositions in HTML/CSS/JS, then renders them locally with Playwright for preview and final export. Use it for HTML or interactive output and layouts that benefit from browser features. For ordinary documents, prefer Word; for new PDF-only reports, prefer Typst.

**Example use cases:**
- "Make a polished 16:9 HTML deck and export preview PNGs plus a PDF."
- "Build a two-page report layout in HTML and check every page before delivery."
- "Create a visual handout with custom CSS, then render it to PDF from the same source file."

**Available tools include:**
- Scaffold bundled starter templates for slide decks and report pages.
- Render HTML into per-page or per-slide PNG previews.
- Generate a `preview-index.html` contact view for quick scanning.
- Export a final PDF from the same HTML source after the preview pass is clean.
- Use bundled `reportlab` when the workflow needs deterministic PDF post-processing after HTML export.

**How to enable:** Set `skills.htmlCanvas.enabled: true` in your server config, rebuild the sandbox runtime image, then select **Canvas** in the Task Composer wrench menu under **Core tools**.

> Canvas depends on the same Playwright Chromium bundle used for browser rendering workflows. When either `skills.browserUse.enabled` or `skills.htmlCanvas.enabled` is on, the sandbox runtime image bundles Chromium.

---

### Guided Learning

**ID:** `guided-learning`

Improves teaching and explanatory responses by organizing them around what the learner needs to understand next. It defines unfamiliar terms, connects intuition to formal reasoning, explains how to discover a solution, and checks understanding without turning every answer into a quiz.

**Example use cases:**
- "Teach me Dijkstra's algorithm from scratch and help me see how I could discover it myself."
- "Explain derivatives one step at a time, and check that I understand before moving on."
- "Give me a complete explanation of database indexes with a visual example."

By default, the skill teaches one connected chunk at a time. When you explicitly ask for a full explanation, it gives a complete sequence from prerequisites and intuition through worked examples, misconceptions, and independent practice.

When Canvas or Interactive Canvas is also available, Guided Learning favors focused diagrams, step-through visualizations, and small interactive experiments when they make the concept easier to understand.

**How to enable:** Select **Guided Learning** in the Skills selector in the Task Composer wrench menu. Enable **Canvas** or **Interactive Canvas** as well when you want the agent to build a visual or hands-on teaching artifact.

---

### Image Generation

**ID:** `image-generation`

Generates a new image through the configured OpenAI-compatible `/images/generations` endpoint, or edits task images through `/images/edits`, and writes the result to a file in the task directory.

**Example use cases:**
- "Generate a transparent app icon and save it as `assets/icon.png`."
- "Edit `assets/product.png` to place it on a studio background and save the result as `assets/product-studio.png`."
- "Create a product mockup image for this report."
- "Make a background image for the Canvas deck and save it in the task files."

**Available tools:**
- Generate one image with the configured model (default `gpt-image-2.5-sunburst`), caller-selected quality and dimensions, optional transparency, format, compression, and a caller-specified filename.
- Edit one or more task images using task-relative paths, an optional transparent mask, optional input fidelity, and a caller-specified output filename. Source files are uploaded to `/images/edits` by the skill; the agent does not pass raw image data.

**How to enable:** Select **Image Generation** in the Skills selector in the Task Composer wrench menu.

> Configure the provider in `skills/image-generation/image-generation.config.json`. The config follows the same provider shape used by Deep AI Search, including `baseURL`, `apiKey`, `apiKeyEnvVar`, `headers`, `name`, retry count, and timeout.

---

### DOCX Studio

**ID:** `docx-studio`

Creates and manipulates Word documents (`.docx` files). Provides deterministic tools for generating polished documents from templates, embedding richer SVG figures, filling placeholders, patching existing files, and fetching reusable templates from the web.

**Example use cases:**
- "Generate a strategy memo and include a process diagram in section 2."
- "Inspect the placeholder tokens in `invoice_template.docx` and tell me what fields need to be filled."
- "Find a DOCX template for a project brief and download it into the workspace."

**Available tools include:**
- Create a new DOCX document with structured content and optional SVG figures.
- Draw standalone SVG figures for reports and briefs.
- Fill a branded template by replacing placeholder tokens.
- Inspect an existing DOCX to list placeholder tokens.
- Patch specific sections or paragraphs in an existing file.
- Search for and download reusable DOCX/DOTX templates.

**How to enable:** First set `skills.office.enabled: true` in your server config and rebuild the sandbox runtime image, then select **DOCX Studio** in the Skills selector in the Task Composer wrench menu.

> DOCX Studio depends on LibreOffice for preview/render flows. When `skills.office.enabled` is off, the sandbox runtime image skips bundling LibreOffice and this skill is hidden.

---

### PPTX Studio

**ID:** `pptx-studio`

Creates and manipulates PowerPoint presentations (`.pptx` files). Provides deterministic tools for generating better-looking slide decks, drawing detailed SVG visuals, filling branded placeholders, and fetching reusable templates from the web.

**Example use cases:**
- "Create a 10-slide pitch deck with roadmap and architecture visuals."
- "List the placeholder tokens in `branded_deck.pptx` so I know what to fill."
- "Find a pitch deck template, download it, and then fill it with our company data."

**Available tools include:**
- Create a new PPTX presentation with optional SVG visuals and metric cards.
- Draw standalone SVG visuals for slides.
- Fill a branded template with content by replacing placeholder tokens.
- Inspect an existing PPTX to list placeholder tokens.
- Search for and download reusable PPTX/POTX templates.

**How to enable:** First set `skills.office.enabled: true` in your server config and rebuild the sandbox runtime image, then select **PPTX Studio** in the Skills selector in the Task Composer wrench menu.

> PPTX Studio depends on LibreOffice for preview/render flows. When `skills.office.enabled` is off, the sandbox runtime image skips bundling LibreOffice and this skill is hidden.

---

### Google Workspace

**ID:** `google-workspace`

Reads, edits, and exports Google Docs, Sheets, and Slides attached directly or contained in a live Google Drive folder.

**Best for:**
- Editing the original shared Google Doc instead of a converted DOCX copy.
- Updating ranges and formatting in an attached Google Sheet.
- Reading or changing slides in an attached Google Slides presentation.
- Reusing an authorized Google file across tasks in the same Project.

**How to enable:** Attach a native Google file and choose **Attach Google files directly**, or attach its containing Google Drive folder with **Live sync**. The skill is enabled automatically for tasks that can access the attachment.

Native Google files in live folders appear as small `.url` links. The agent can use a link to read or edit the original, or export a separate DOCX, XLSX, or PPTX when needed. Attaching the folder does not download or convert all its documents.

> Direct editing is Experimental and changes the original shared Google file immediately. Files must be attached directly or remain inside an attached live folder. Connecting Google Drive or copying a link alone does not grant access. Editing an exported Office copy does not update the Google original.

---

### OpenAI: doc

**ID:** `openai-doc`

Imported OpenAI curated workflow for `.docx` work. Focuses on shell/Python-based document creation, editing, rendering, and visual review with the bundled helper scripts and references copied from `openai/skills`.

**Best for:**
- Editing or generating Word documents with a shell/Python workflow instead of deterministic MCP-only tools.
- Render-first review loops where the agent should convert DOCX files to page images and inspect layout before delivery.
- Custom Word layouts using reusable styles and the bundled document libraries.

**How to enable:** Select **OpenAI: doc** in the Skills selector in the Task Composer wrench menu.

---

### Typst

**ID:** `typst`

Creates PDF documents from readable, editable text source. Typst handles pagination, tables, references, and page numbering while supporting custom typography, covers, and layouts.

**Best for:**
- New PDF-only reports, proposals, guides, and handouts.
- Technical documents with equations, figures, and cross-references.
- Documents that should reflow when text or table rows change.

The skill includes a customizable starter and works locally with the bundled compiler and fonts. It retains the source and assets beside the PDF so later revisions are straightforward. Typst does not produce an editable Word file; use a Word skill when that is required.

**How to enable:** Select **Typst** in the Skills selector in the Task Composer wrench menu. The agent can also activate it when a PDF-only request calls for it.

---

### Example (testing only)

**ID:** `example`

A simple skill for testing that the skills system is working correctly. Provides an echo tool and a random number generator. Not useful for real tasks.

---

## Configuring the skills directory

Skills are loaded from the directory specified in your config:

```json
{
  "skills": {
    "rootDir": "./skills"
  }
}
```

Each subdirectory in `rootDir` that contains a valid `skill.json` is loaded as a skill.

## Adding a custom skill

To add a new skill:

1. Create a subdirectory under `skills/` with a unique name (e.g., `skills/my-tool/`).
2. Create `skill.json` with the following structure:
   ```json
   {
     "id": "my-tool",
     "name": "My Tool",
     "description": "What this skill does.",
     "mcp": {
       "transport": "stdio",
       "command": "node",
       "args": ["server.mjs"],
       "cwd": "{{SKILL_DIR}}"
     }
   }
   ```
   - `{{SKILL_DIR}}` is replaced at runtime with the absolute path to the skill's directory.
   - `requiresSuperAdmin: true` can be added to restrict visibility to super-admin accounts.
3. Create `skill.md` with documentation shown to the agent when the skill is active.
4. Implement the MCP server (e.g., `server.mjs`) that exposes the tools.
5. Restart the worker to load the new skill.

The new skill will appear in the Skills selector in the Task Composer.
