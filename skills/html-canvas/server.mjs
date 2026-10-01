import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createInlineFileArtifact,
  createInlineHtmlArtifact,
  HTML_CANVAS_PAGE_SELECTOR,
  listHtmlCanvasTemplates,
  renderHtmlCanvasDocument,
  scaffoldHtmlCanvasTemplate
} from "../shared/html-canvas-utils.mjs";

function asToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

const server = new McpServer({
  name: "html-canvas",
  version: "1.0.0"
});

server.tool(
  "html_canvas_scaffold",
  "Copy a bundled starter into the workspace. `slide-deck` is a single-file deck built on <meowbert-deck> (copies meowbert-deck.js beside it); `report-pages` has explicit A4 page wrappers.",
  {
    template: z.enum(["slide-deck", "report-pages"]).describe("Starter template to copy."),
    output_path: z
      .string()
      .min(1)
      .describe("Destination path for the generated HTML file. Relative paths resolve from the agent's current working directory."),
    title: z.string().min(1).nullable().optional().describe("Optional title placeholder."),
    subtitle: z.string().min(1).nullable().optional().describe("Optional subtitle placeholder.")
  },
  async ({ template, output_path, title, subtitle }) => {
    const result = await scaffoldHtmlCanvasTemplate({
      template,
      outputPath: output_path,
      title,
      subtitle
    });
    return asToolResult({
      ...result,
      available_templates: listHtmlCanvasTemplates()
    });
  }
);

server.tool(
  "html_canvas_render",
  "Render an HTML document, or a directory of HTML files, to preview PNGs, a preview index, and an optional PDF using bundled Playwright Chromium. A single file captures each [data-meowbert-page] element as one page (including <meowbert-deck> slides); a directory captures each HTML file as one page. The result includes page-fit and overflow diagnostics so clipping is visible to the agent.",
  {
    input_path: z
      .string()
      .min(1)
      .describe("Path to the HTML entrypoint, or a directory of `.html` / `.htm` files. Relative paths resolve from the agent's current working directory."),
    output_dir: z
      .string()
      .min(1)
      .describe("Directory where previews and reports should be written. Relative paths resolve from the agent's current working directory."),
    layout: z
      .enum(["slides", "pages", "single"])
      .nullable()
      .optional()
      .describe("How to interpret the document when capturing previews. Directory inputs still render one HTML file as one page, using this layout's viewport."),
    orientation: z
      .enum(["portrait", "landscape"])
      .nullable()
      .optional()
      .describe("Optional default viewport orientation. Useful for forcing landscape page rendering, especially for directory-based slide decks."),
    page_selector: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe(`Selector for page wrappers. Defaults to ${HTML_CANVAS_PAGE_SELECTOR}. Ignored for directory inputs.`),
    viewport_width: z.number().int().positive().nullable().optional().describe("Optional viewport width override."),
    viewport_height: z.number().int().positive().nullable().optional().describe("Optional viewport height override."),
    wait_for_selector: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Optional selector that must appear before capture begins."),
    create_pdf: z.boolean().nullable().optional().describe("Whether to export a PDF alongside previews."),
    pdf_file_name: z.string().min(1).nullable().optional().describe("Optional output PDF filename."),
    timeout_ms: z.number().int().positive().nullable().optional().describe("Render timeout in milliseconds.")
  },
  async ({
    input_path,
    output_dir,
    layout,
    orientation,
    page_selector,
    viewport_width,
    viewport_height,
    wait_for_selector,
    create_pdf,
    pdf_file_name,
    timeout_ms
  }) => {
    const result = await renderHtmlCanvasDocument({
      inputPath: input_path,
      outputDir: output_dir,
      layout: layout ?? "slides",
      orientation: orientation ?? null,
      pageSelector: page_selector ?? HTML_CANVAS_PAGE_SELECTOR,
      viewportWidth: viewport_width ?? null,
      viewportHeight: viewport_height ?? null,
      waitForSelector: wait_for_selector ?? null,
      createPdf: create_pdf ?? false,
      pdfFileName: pdf_file_name ?? "document.pdf",
      timeoutMs: timeout_ms ?? 30_000
    });
    return asToolResult(result);
  }
);

server.tool(
  "html_canvas_inline_artifact",
  "Write an HTML artifact into the current task directory and display it inline in the task conversation before the assistant message.",
  {
    html: z.string().min(1).describe("Full HTML document source to write and display inline."),
    output_path: z
      .string()
      .min(1)
      .describe("Destination HTML file path inside the current task directory. Relative paths resolve from the agent's current working directory."),
    title: z.string().min(1).nullable().optional().describe("Optional title shown above the inline artifact."),
    description: z.string().min(1).nullable().optional().describe("Optional short caption shown above the inline artifact."),
    width: z
      .number()
      .int()
      .min(320)
      .max(2000)
      .nullable()
      .optional()
      .describe("Optional default inline preview width in pixels. This sets the base card width before the user resizes it with the +/- controls."),
    height: z
      .number()
      .int()
      .min(240)
      .max(1600)
      .nullable()
      .optional()
      .describe("Optional iframe height in pixels for the inline preview.")
  },
  async ({ html, output_path, title, description, width, height }) => {
    const result = await createInlineHtmlArtifact({
      html,
      outputPath: output_path,
      title: title ?? null,
      description: description ?? null,
      width: width ?? null,
      height: height ?? null
    });
    return asToolResult(result);
  }
);

server.tool(
  "html_canvas_inline_file_artifact",
  "Display an existing task-local HTML, image, or Mermaid file inline in the task conversation. For HTML, relative links and assets beside the file load too, so multi-page sites and decks work.",
  {
    input_path: z.string().min(1).describe("Existing HTML, image, or Mermaid file inside the current task directory."),
    type: z.enum(["html", "image", "mermaid"]).describe("Inline artifact renderer to use."),
    title: z.string().min(1).nullable().optional().describe("Optional title shown above the inline artifact."),
    description: z.string().min(1).nullable().optional().describe("Optional short caption shown above the inline artifact."),
    width: z.number().int().min(320).max(2000).nullable().optional().describe("Optional default inline preview width in pixels."),
    height: z.number().int().min(240).max(1600).nullable().optional().describe("Optional preview height in pixels.")
  },
  async ({ input_path, type, title, description, width, height }) => {
    const result = await createInlineFileArtifact({
      inputPath: input_path,
      type,
      title: title ?? null,
      description: description ?? null,
      width: width ?? null,
      height: height ?? null
    });
    return asToolResult(result);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
