import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { convertOfficeDocumentToPdf } from "../shared/office-utils.mjs";
import { replaceTextInDocxBuffer } from "../shared/ooxml-edit-utils.mjs";
import { resolveTaskScopedUserPath } from "../shared/task-path-utils.mjs";
import { fetchTemplateToPath, searchTemplateCatalog } from "../shared/template-utils.mjs";
import {
  VISUAL_KIND_KEYS,
  createTransparentPngFallback,
  defaultVisualTheme,
  writeBusinessSvg
} from "../shared/visual-utils.mjs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  PatchType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  patchDetector,
  patchDocument
} from "docx";

const STYLE_PRESETS = {
  "modern-report": {
    headingFont: "Aptos",
    bodyFont: "Aptos",
    titleSize: 52,
    subtitleSize: 28,
    headingSize: 32,
    bodySize: 23,
    headingColor: "1D3557",
    bodyColor: "1F2937",
    subtitleColor: "4B5563",
    accentSoftColor: "EAF1FB",
    accentDarkColor: "16324F",
    bodyAlign: AlignmentType.JUSTIFIED,
    pageMargins: { top: 900, right: 900, bottom: 900, left: 900 }
  },
  "executive-brief": {
    headingFont: "Calibri",
    bodyFont: "Calibri",
    titleSize: 48,
    subtitleSize: 26,
    headingSize: 30,
    bodySize: 22,
    headingColor: "0B1F3A",
    bodyColor: "111827",
    subtitleColor: "374151",
    accentSoftColor: "EEF2F7",
    accentDarkColor: "0B1F3A",
    bodyAlign: AlignmentType.LEFT,
    pageMargins: { top: 860, right: 860, bottom: 860, left: 860 }
  },
  "academic-clean": {
    headingFont: "Times New Roman",
    bodyFont: "Times New Roman",
    titleSize: 46,
    subtitleSize: 24,
    headingSize: 30,
    bodySize: 24,
    headingColor: "1F2937",
    bodyColor: "111111",
    subtitleColor: "444444",
    accentSoftColor: "F1F5F9",
    accentDarkColor: "334155",
    bodyAlign: AlignmentType.JUSTIFIED,
    pageMargins: { top: 1080, right: 900, bottom: 1080, left: 900 }
  }
};

const SECTION_LAYOUT_KEYS = ["body", "summary", "callout", "quote"];

const TEXT_REPLACEMENT_SCHEMA = z.object({
  find: z.string().min(1).describe("Literal text to find."),
  replace: z.string().describe("Replacement text."),
  replace_all: z.boolean().nullable().optional().describe("Replace every matching occurrence, default true."),
  ignore_case: z.boolean().nullable().optional().describe("Perform a case-insensitive match.")
});

const VISUAL_ITEM_SCHEMA = z.union([
  z.string().min(1),
  z.object({
    label: z.string().min(1).nullable().optional(),
    title: z.string().min(1).nullable().optional(),
    body: z.string().min(1).nullable().optional(),
    value: z.string().min(1).nullable().optional()
  })
]);

const VISUAL_SPEC_SCHEMA = z.object({
  kind: z.enum(VISUAL_KIND_KEYS),
  title: z.string().min(1).nullable().optional(),
  subtitle: z.string().min(1).nullable().optional(),
  footer: z.string().min(1).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  items: z.array(VISUAL_ITEM_SCHEMA).min(1).nullable().optional()
});

function resolveUserPath(inputPath) {
  return resolveTaskScopedUserPath(inputPath);
}

async function readBinaryFile(inputPath) {
  const absolutePath = resolveUserPath(inputPath);
  return { absolutePath, data: await fs.readFile(absolutePath) };
}

async function writeBinaryFile(outputPath, data) {
  const absolutePath = resolveUserPath(outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, data);
  return absolutePath;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJsonPayload(payloadText, fieldName) {
  try {
    return JSON.parse(payloadText);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

function countWords(text) {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).length;
}

function contentWordCount(sections) {
  return sections.reduce((total, section) => {
    const eyebrowWords = section.eyebrow ? countWords(section.eyebrow) : 0;
    const headingWords = section.heading ? countWords(section.heading) : 0;
    const calloutWords = section.callout ? countWords(section.callout) : 0;
    const paragraphWords = (section.paragraphs ?? []).reduce((sum, paragraph) => sum + countWords(paragraph), 0);
    const bulletWords = (section.bullets ?? []).reduce((sum, bullet) => sum + countWords(bullet), 0);
    const metricWords = (section.metrics ?? []).reduce(
      (sum, metric) => sum + countWords(metric.value) + countWords(metric.label),
      0
    );
    return total + eyebrowWords + headingWords + calloutWords + paragraphWords + bulletWords + metricWords;
  }, 0);
}

function summarizeTemplateData(data) {
  if (Array.isArray(data)) {
    return {
      kind: "array",
      top_level_keys: [],
      item_count: data.length
    };
  }

  if (data && typeof data === "object") {
    return {
      kind: "object",
      top_level_keys: Object.keys(data).sort(),
      item_count: null
    };
  }

  return {
    kind: typeof data,
    top_level_keys: [],
    item_count: null
  };
}

function parseDocxtemplaterTokensFromBuffer(buffer, delimiters) {
  const start = delimiters.start;
  const end = delimiters.end;
  const regex = new RegExp(
    `${escapeRegExp(start)}\\s*([A-Za-z0-9_.:-]+)\\s*${escapeRegExp(end)}`,
    "g"
  );

  const zip = new PizZip(buffer.toString("binary"));
  const tokens = new Set();

  for (const fileName of Object.keys(zip.files)) {
    if (!/^word\/.*\.xml$/i.test(fileName)) {
      continue;
    }

    const file = zip.file(fileName);
    if (!file) {
      continue;
    }

    const xml = file.asText();
    const plainText = xml.replace(/<[^>]*>/g, "");

    for (const match of plainText.matchAll(regex)) {
      const token = match[1]?.trim();
      if (token) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens).sort();
}

function safeDocxtemplaterError(error) {
  if (!error || typeof error !== "object") {
    return "Unknown template error";
  }

  const message = error instanceof Error ? error.message : String(error);
  const properties = "properties" in error ? error.properties : null;

  if (properties && typeof properties === "object" && Array.isArray(properties.errors)) {
    const details = properties.errors
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const explanation = entry.properties?.explanation;
        const id = entry.properties?.id;
        if (typeof explanation === "string" && typeof id === "string") {
          return `${id}: ${explanation}`;
        }
        if (typeof explanation === "string") {
          return explanation;
        }
        return null;
      })
      .filter(Boolean);

    if (details.length > 0) {
      return `${message}. ${details.join(" | ")}`;
    }
  }

  return message;
}

function patchRunsFromText(value) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length === 1) {
    return [new TextRun({ text: lines[0] })];
  }

  return lines.map((line, index) =>
    new TextRun({
      text: line,
      ...(index > 0 ? { break: 1 } : {})
    })
  );
}

function styledParagraphFromText(text, preset) {
  return new Paragraph({
    alignment: preset.bodyAlign,
    spacing: {
      after: 180,
      line: 340,
      lineRule: "auto"
    },
    children: [
      new TextRun({
        text,
        font: preset.bodyFont,
        color: preset.bodyColor,
        size: preset.bodySize
      })
    ]
  });
}

function styledBulletFromText(text, preset) {
  return new Paragraph({
    bullet: {
      level: 0
    },
    spacing: {
      after: 120,
      line: 310,
      lineRule: "auto"
    },
    children: [
      new TextRun({
        text,
        font: preset.bodyFont,
        color: preset.bodyColor,
        size: preset.bodySize
      })
    ]
  });
}

function styledEyebrowParagraph(text, preset) {
  return new Paragraph({
    spacing: { before: 220, after: 50 },
    children: [
      new TextRun({
        text: String(text).toUpperCase(),
        bold: true,
        font: preset.bodyFont,
        color: preset.headingColor,
        size: preset.bodySize - 2
      })
    ]
  });
}

function styledHeadingParagraph(text, preset) {
  return new Paragraph({
    spacing: { before: 180, after: 120 },
    border: {
      left: {
        color: preset.headingColor,
        size: 20,
        style: BorderStyle.SINGLE,
        space: 8
      }
    },
    indent: { left: 160 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: preset.headingFont,
        color: preset.headingColor,
        size: preset.headingSize
      })
    ]
  });
}

function styledCalloutParagraph(text, preset, { large = false } = {}) {
  return new Paragraph({
    alignment: large ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 100, after: 180, line: 330, lineRule: "auto" },
    shading: {
      fill: preset.accentSoftColor
    },
    border: {
      left: {
        color: preset.headingColor,
        size: 18,
        style: BorderStyle.SINGLE
      }
    },
    indent: { left: 180, right: 180 },
    children: [
      new TextRun({
        text,
        italics: large,
        bold: large,
        font: large ? preset.headingFont : preset.bodyFont,
        color: preset.bodyColor,
        size: large ? preset.bodySize + 6 : preset.bodySize
      })
    ]
  });
}

function styledQuoteAttributionParagraph(text, preset) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 180 },
    children: [
      new TextRun({
        text,
        font: preset.bodyFont,
        color: preset.subtitleColor,
        size: preset.bodySize - 2
      })
    ]
  });
}

function metricTableFromSection(metrics, preset) {
  const visibleMetrics = (metrics ?? []).slice(0, 4);
  if (visibleMetrics.length === 0) {
    return null;
  }

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
    },
    rows: [
      new TableRow({
        children: visibleMetrics.map((metric) =>
          new TableCell({
            shading: { fill: preset.accentSoftColor },
            margins: { top: 160, right: 160, bottom: 140, left: 160 },
            width: {
              size: Math.floor(100 / visibleMetrics.length),
              type: WidthType.PERCENTAGE
            },
            children: [
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  new TextRun({
                    text: metric.value,
                    bold: true,
                    font: preset.headingFont,
                    color: preset.headingColor,
                    size: preset.headingSize - 4
                  })
                ]
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: metric.label,
                    font: preset.bodyFont,
                    color: preset.subtitleColor,
                    size: preset.bodySize - 2
                  })
                ]
              })
            ]
          })
        )
      })
    ]
  });
}

function resolveSectionLayout(section) {
  if (section.layout) {
    return section.layout;
  }
  if ((section.metrics?.length ?? 0) >= 2) {
    return "summary";
  }
  if (section.callout && !(section.paragraphs?.length ?? 0) && !(section.bullets?.length ?? 0)) {
    return "quote";
  }
  if (section.callout) {
    return "callout";
  }
  return "body";
}

function visualThemeFromPreset(preset) {
  return defaultVisualTheme({
    background: "FFFFFF",
    surface: "FFFFFF",
    ink: preset.headingColor,
    muted: preset.subtitleColor,
    accent: preset.headingColor,
    accentSoft: preset.accentSoftColor
  });
}

async function resolveSectionVisual(section, preset, outputPath, sectionIndex) {
  if (section.visual_svg_path) {
    return {
      outputPath: resolveUserPath(section.visual_svg_path),
      generated: false
    };
  }

  if (!section.visual) {
    return null;
  }

  const absoluteOutputPath = resolveUserPath(outputPath);
  const assetPath = path.join(`${absoluteOutputPath}.assets`, `section-${sectionIndex}-${section.visual.kind}.svg`);
  const written = await writeBusinessSvg(assetPath, {
    kind: section.visual.kind,
    title: section.visual.title ?? section.heading ?? `Section ${sectionIndex}`,
    subtitle: section.visual.subtitle ?? (section.paragraphs ?? [])[0] ?? "",
    footer: section.visual.footer ?? "",
    width: section.visual.width ?? 1400,
    height: section.visual.height ?? 800,
    items: section.visual.items ?? section.bullets ?? [],
    theme: visualThemeFromPreset(preset)
  });

  return {
    outputPath: written.outputPath,
    generated: true,
    width: section.visual.width ?? 560,
    height: section.visual.height ?? 320
  };
}

async function buildSectionVisualChildren(section, preset, outputPath, sectionIndex) {
  const visual = await resolveSectionVisual(section, preset, outputPath, sectionIndex);
  if (!visual) {
    return { children: [], generatedAsset: null };
  }

  const svgData = await fs.readFile(visual.outputPath);
  const imageWidth = Math.min(section.visual_width_px ?? visual.width ?? 560, 620);
  const imageHeight = Math.min(section.visual_height_px ?? visual.height ?? 320, 420);
  const imageRun = new ImageRun({
    type: "svg",
    data: svgData,
    transformation: {
      width: imageWidth,
      height: imageHeight
    },
    fallback: {
      type: "png",
      data: createTransparentPngFallback(),
      transformation: {
        width: imageWidth,
        height: imageHeight
      }
    }
  });

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: section.visual_caption ? 60 : 180 },
      children: [imageRun]
    })
  ];

  if (section.visual_caption) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 180 },
        children: [
          new TextRun({
            text: section.visual_caption,
            italics: true,
            font: preset.bodyFont,
            color: preset.subtitleColor,
            size: preset.bodySize - 2
          })
        ]
      })
    );
  }

  return {
    children,
    generatedAsset: visual.generated ? visual.outputPath : null
  };
}

const server = new McpServer({
  name: "docx-studio",
  version: "1.2.0"
});

server.tool(
  "docx_create_styled_document",
  "Create a more polished DOCX from structured sections using richer section layouts, optional metrics/callouts, and SVG figures.",
  {
    output_path: z.string().min(1).describe("Destination path for the generated .docx file."),
    title: z.string().min(1).nullable().optional().describe("Optional document title."),
    subtitle: z.string().min(1).nullable().optional().describe("Optional subtitle under the title."),
    author: z.string().min(1).nullable().optional().describe("Optional author metadata."),
    style_preset: z
      .enum(["modern-report", "executive-brief", "academic-clean"])
      .nullable()
      .optional()
      .describe("Visual preset for typography and spacing."),
    sections: z
      .array(
        z.object({
          layout: z.enum(SECTION_LAYOUT_KEYS).nullable().optional(),
          eyebrow: z.string().min(1).nullable().optional(),
          heading: z.string().min(1).nullable().optional(),
          callout: z.string().min(1).nullable().optional(),
          quote_attribution: z.string().min(1).nullable().optional(),
          paragraphs: z.array(z.string().min(1)).nullable().optional(),
          bullets: z.array(z.string().min(1)).nullable().optional(),
          metrics: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).max(4).nullable().optional(),
          visual_svg_path: z.string().min(1).nullable().optional(),
          visual_caption: z.string().min(1).nullable().optional(),
          visual_width_px: z.number().int().positive().nullable().optional(),
          visual_height_px: z.number().int().positive().nullable().optional(),
          visual: VISUAL_SPEC_SCHEMA.nullable().optional()
        })
      )
      .min(1)
      .describe("Ordered sections with heading, paragraphs, optional bullets, and optional SVG figures.")
  },
  async ({ output_path, title, subtitle, author, style_preset, sections }) => {
    const presetKey = style_preset ?? "modern-report";
    const preset = STYLE_PRESETS[presetKey];

    const children = [];
    const generatedAssets = [];
    const sectionLayouts = [];

    if (title) {
      children.push(
        new Paragraph({
          spacing: { after: subtitle ? 60 : 120 },
          border: {
            bottom: {
              color: preset.headingColor,
              size: 18,
              style: BorderStyle.SINGLE,
              space: 10
            }
          },
          children: [
            new TextRun({
              text: title,
              bold: true,
              font: preset.headingFont,
              color: preset.headingColor,
              size: preset.titleSize
            })
          ]
        })
      );
    }

    if (subtitle) {
      children.push(
        new Paragraph({
          spacing: { after: 260 },
          children: [
            new TextRun({
              text: subtitle,
              italics: true,
              font: preset.bodyFont,
              color: preset.subtitleColor,
              size: preset.subtitleSize
            })
          ]
        })
      );
    }

    for (const [index, section] of sections.entries()) {
      const paragraphs = section.paragraphs ?? [];
      const bullets = section.bullets ?? [];
      const sectionLayout = resolveSectionLayout(section);
      sectionLayouts.push(sectionLayout);

      if (section.eyebrow) {
        children.push(styledEyebrowParagraph(section.eyebrow, preset));
      }

      if (section.heading) {
        children.push(styledHeadingParagraph(section.heading, preset));
      }

      if (sectionLayout === "quote" && section.callout) {
        children.push(styledCalloutParagraph(section.callout, preset, { large: true }));
        if (section.quote_attribution) {
          children.push(styledQuoteAttributionParagraph(section.quote_attribution, preset));
        }
      } else if (section.callout) {
        children.push(styledCalloutParagraph(section.callout, preset));
      }

      if ((section.metrics?.length ?? 0) > 0) {
        const metricsTable = metricTableFromSection(section.metrics, preset);
        if (metricsTable) {
          children.push(metricsTable);
          children.push(
            new Paragraph({
              spacing: { after: 80 },
              children: [new TextRun("")]
            })
          );
        }
      }

      for (const paragraph of paragraphs) {
        children.push(styledParagraphFromText(paragraph, preset));
      }

      for (const bullet of bullets) {
        children.push(styledBulletFromText(bullet, preset));
      }

      const visualBlock = await buildSectionVisualChildren(section, preset, output_path, index + 1);
      children.push(...visualBlock.children);
      if (visualBlock.generatedAsset) {
        generatedAssets.push(visualBlock.generatedAsset);
      }
    }

    if (children.length === 0) {
      throw new Error("No content was provided. Add title/subtitle or section text.");
    }

    const doc = new Document({
      creator: author ?? "Meowbert",
      title: title ?? "Generated Document",
      description: `Generated by docx-studio (${presetKey})`,
      sections: [
        {
          properties: {
            page: {
              margin: preset.pageMargins
            }
          },
          children
        }
      ]
    });

    const outputBuffer = await Packer.toBuffer(doc);
    const absoluteOutputPath = await writeBinaryFile(output_path, outputBuffer);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              output_path: absoluteOutputPath,
              style_preset: presetKey,
              section_count: sections.length,
              section_layouts: sectionLayouts,
              approximate_word_count: contentWordCount(sections),
              generated_assets: generatedAssets
            },
            null,
            2
          )
        }
      ]
    };
  }
);


server.tool(
  "docx_draw_figure_svg",
  "Create a detailed SVG figure for inclusion in DOCX reports and briefs.",
  {
    output_path: z.string().min(1).describe("Destination path for generated .svg file."),
    style_preset: z
      .enum(["modern-report", "executive-brief", "academic-clean"])
      .nullable()
      .optional()
      .describe("Optional palette preset used for the SVG."),
    kind: z.enum(VISUAL_KIND_KEYS).describe("Visual layout to render."),
    title: z.string().min(1).describe("Figure title."),
    subtitle: z.string().min(1).nullable().optional().describe("Optional subtitle or explanatory line."),
    footer: z.string().min(1).nullable().optional().describe("Optional footer or source note."),
    width: z.number().int().positive().nullable().optional().describe("Optional SVG width, default 1400."),
    height: z.number().int().positive().nullable().optional().describe("Optional SVG height, default 800."),
    items: z.array(VISUAL_ITEM_SCHEMA).min(1).describe("Structured items shown inside the figure.")
  },
  async ({ output_path, style_preset, kind, title, subtitle, footer, width, height, items }) => {
    const presetKey = style_preset ?? "modern-report";
    const written = await writeBusinessSvg(output_path, {
      kind,
      title,
      subtitle: subtitle ?? "",
      footer: footer ?? "",
      width: width ?? 1400,
      height: height ?? 800,
      items,
      theme: visualThemeFromPreset(STYLE_PRESETS[presetKey])
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              output_path: written.outputPath,
              kind: written.kind,
              style_preset: presetKey,
              width: written.width,
              height: written.height,
              item_count: items.length
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  "docx_find_templates",
  "Search the web for DOCX/DOTX templates that can be downloaded and reused.",
  {
    query: z.string().min(1).describe("Search phrase describing the template you want."),
    limit: z.number().int().positive().max(10).nullable().optional().describe("Maximum number of results to return.")
  },
  async ({ query, limit }) => {
    const search = await searchTemplateCatalog({
      query,
      extensions: ["docx", "dotx"],
      limit: limit ?? 5
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              ...search,
              supported_extensions: [".docx", ".dotx"]
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  "docx_get_template",
  "Download a DOCX/DOTX template from a direct link or from a web page that exposes template files.",
  {
    url: z.string().url().describe("Direct file URL or template page URL."),
    output_path: z.string().min(1).describe("Destination path for the downloaded template."),
    allow_page_link_discovery: z.boolean().nullable().optional().describe("When true, scan HTML pages for .docx/.dotx links.")
  },
  async ({ url, output_path, allow_page_link_discovery }) => {
    const downloaded = await fetchTemplateToPath({
      url,
      outputPath: output_path,
      extensions: ["docx", "dotx"],
      allowPageLinkDiscovery: allow_page_link_discovery ?? true
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              output_path: downloaded.outputPath,
              source_url: downloaded.sourceUrl,
              final_url: downloaded.finalUrl,
              filename: downloaded.filename,
              content_type: downloaded.contentType,
              discovered_links: downloaded.discoveredLinks
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  "docx_fill_template",
  "Fill a DOCX template using JSON payload data and configurable delimiters.",
  {
    template_path: z.string().min(1).describe("Path to input template .docx file."),
    output_path: z.string().min(1).describe("Path for rendered .docx output."),
    data_json: z.string().min(2).describe("JSON object string used for template variables."),
    start_delimiter: z.string().min(1).nullable().optional().describe("Template start delimiter, default {."),
    end_delimiter: z.string().min(1).nullable().optional().describe("Template end delimiter, default }."),
    paragraph_loop: z.boolean().nullable().optional().describe("Enable paragraph loop processing."),
    linebreaks: z.boolean().nullable().optional().describe("Convert line breaks to DOCX line breaks.")
  },
  async ({
    template_path,
    output_path,
    data_json,
    start_delimiter,
    end_delimiter,
    paragraph_loop,
    linebreaks
  }) => {
    const data = parseJsonPayload(data_json, "data_json");
    const { absolutePath: absoluteTemplatePath, data: templateBuffer } = await readBinaryFile(template_path);

    const delimiters = {
      start: start_delimiter ?? "{",
      end: end_delimiter ?? "}"
    };

    try {
      const zip = new PizZip(templateBuffer.toString("binary"));
      const doc = new Docxtemplater(zip, {
        paragraphLoop: paragraph_loop ?? true,
        linebreaks: linebreaks ?? true,
        delimiters
      });

      doc.render(data);

      const rendered = doc.getZip().generate({
        type: "nodebuffer",
        compression: "DEFLATE"
      });

      const absoluteOutputPath = await writeBinaryFile(output_path, rendered);
      const dataSummary = summarizeTemplateData(data);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                template_path: absoluteTemplatePath,
                output_path: absoluteOutputPath,
                delimiters,
                data_summary: dataSummary
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      throw new Error(`docx_fill_template failed: ${safeDocxtemplaterError(error)}`);
    }
  }
);

server.tool(
  "docx_inspect_placeholders",
  "Inspect likely placeholders in a DOCX file for template fill and patch workflows.",
  {
    template_path: z.string().min(1).describe("Path to input .docx file."),
    start_delimiter: z.string().min(1).nullable().optional().describe("Start delimiter for template tokens."),
    end_delimiter: z.string().min(1).nullable().optional().describe("End delimiter for template tokens."),
    include_patch_tokens: z.boolean().nullable().optional().describe("Include patchDocument token detection.")
  },
  async ({ template_path, start_delimiter, end_delimiter, include_patch_tokens }) => {
    const { absolutePath: absoluteTemplatePath, data: templateBuffer } = await readBinaryFile(template_path);

    const delimiters = {
      start: start_delimiter ?? "{",
      end: end_delimiter ?? "}"
    };

    const docxtemplaterTokens = parseDocxtemplaterTokensFromBuffer(templateBuffer, delimiters);

    let patchTokens = [];
    if (include_patch_tokens ?? true) {
      try {
        patchTokens = await patchDetector({ data: templateBuffer });
      } catch {
        patchTokens = [];
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              template_path: absoluteTemplatePath,
              delimiters,
              docxtemplater_tokens: docxtemplaterTokens,
              patch_tokens: patchTokens,
              counts: {
                docxtemplater_tokens: docxtemplaterTokens.length,
                patch_tokens: patchTokens.length
              }
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  "docx_replace_text",
  "Replace literal text inside an existing DOCX file while preserving the surrounding document structure.",
  {
    source_path: z.string().min(1).describe("Path to the source .docx file."),
    output_path: z.string().min(1).describe("Path for the edited .docx output."),
    replacements: z
      .array(TEXT_REPLACEMENT_SCHEMA)
      .min(1)
      .describe("Literal find/replace operations applied paragraph by paragraph across main body, headers, and footers.")
  },
  async ({ source_path, output_path, replacements }) => {
    const { absolutePath: absoluteSourcePath, data: sourceBuffer } = await readBinaryFile(source_path);
    const edited = replaceTextInDocxBuffer(sourceBuffer, replacements);
    const absoluteOutputPath = await writeBinaryFile(output_path, edited.buffer);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              source_path: absoluteSourcePath,
              output_path: absoluteOutputPath,
              replacement_count: edited.replacementCount,
              changed_parts: edited.changedParts
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  "docx_render_pdf",
  "Convert a DOCX/DOTX document to PDF so an agent can preview the whole file or a page range with view_pdf_file.",
  {
    source_path: z.string().min(1).describe("Path to the source .docx/.dotx file."),
    output_path: z.string().min(1).describe("Destination path for the rendered .pdf file."),
    start_page: z.number().int().positive().nullable().optional().describe("Optional first page number to export."),
    end_page: z.number().int().positive().nullable().optional().describe("Optional last page number to export.")
  },
  async ({ source_path, output_path, start_page, end_page }) => {
    const rendered = await convertOfficeDocumentToPdf({
      inputPath: source_path,
      outputPath: output_path,
      exportFilter: "writer_pdf_Export",
      startPage: start_page,
      endPage: end_page
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              source_path: rendered.inputPath,
              output_path: rendered.outputPath,
              export_filter: rendered.exportFilter,
              page_range: rendered.pageRange
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  "docx_patch_tokens",
  "Patch placeholders in a DOCX file using docx.patchDocument while preserving styles.",
  {
    source_path: z.string().min(1).describe("Path to source .docx file."),
    output_path: z.string().min(1).describe("Path to patched .docx output."),
    replacements: z
      .array(
        z.object({
          token: z.string().min(1),
          value: z.string()
        })
      )
      .min(1)
      .describe("List of token/value replacements without delimiters in token names."),
    keep_original_styles: z.boolean().nullable().optional().describe("Preserve surrounding source styles."),
    start_delimiter: z.string().min(1).nullable().optional().describe("Placeholder start delimiter, default {{."),
    end_delimiter: z.string().min(1).nullable().optional().describe("Placeholder end delimiter, default }}.")
  },
  async ({
    source_path,
    output_path,
    replacements,
    keep_original_styles,
    start_delimiter,
    end_delimiter
  }) => {
    const { absolutePath: absoluteSourcePath, data: sourceBuffer } = await readBinaryFile(source_path);

    const patches = {};
    for (const replacement of replacements) {
      patches[replacement.token] = {
        type: PatchType.PARAGRAPH,
        children: patchRunsFromText(replacement.value)
      };
    }

    const patchedBuffer = await patchDocument({
      outputType: "nodebuffer",
      data: sourceBuffer,
      patches,
      keepOriginalStyles: keep_original_styles ?? true,
      placeholderDelimiters: {
        start: start_delimiter ?? "{{",
        end: end_delimiter ?? "}}"
      }
    });

    const absoluteOutputPath = await writeBinaryFile(output_path, patchedBuffer);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              source_path: absoluteSourcePath,
              output_path: absoluteOutputPath,
              patched_tokens: replacements.map((item) => item.token)
            },
            null,
            2
          )
        }
      ]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
