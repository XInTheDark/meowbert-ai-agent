import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { convertOfficeDocumentToPdf } from "../shared/office-utils.mjs";
import { replaceTextInPptxBuffer } from "../shared/ooxml-edit-utils.mjs";
import { resolveTaskScopedUserPath } from "../shared/task-path-utils.mjs";
import { fetchTemplateToPath, searchTemplateCatalog } from "../shared/template-utils.mjs";
import { VISUAL_KIND_KEYS, defaultVisualTheme, writeBusinessSvg } from "../shared/visual-utils.mjs";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");
const PPTX_SHAPES = new PptxGenJS().ShapeType;

const DECK_PRESETS = {
  "modern-product": {
    layout: "LAYOUT_WIDE",
    headingFont: "Aptos Display",
    bodyFont: "Aptos",
    backgroundColor: "F8FAFC",
    surfaceColor: "FFFFFF",
    surfaceAltColor: "EEF4FF",
    titleColor: "0F172A",
    bodyColor: "1F2937",
    mutedColor: "475569",
    accentColor: "2563EB",
    accentDarkColor: "1D4ED8",
    accentSoftColor: "DBEAFE"
  },
  "investor-clean": {
    layout: "LAYOUT_WIDE",
    headingFont: "Calibri",
    bodyFont: "Calibri",
    backgroundColor: "FFFFFF",
    surfaceColor: "FFFFFF",
    surfaceAltColor: "F7FAFC",
    titleColor: "111827",
    bodyColor: "1F2937",
    mutedColor: "4B5563",
    accentColor: "0B1F3A",
    accentDarkColor: "091427",
    accentSoftColor: "E2E8F0"
  },
  "academic-minimal": {
    layout: "LAYOUT_WIDE",
    headingFont: "Times New Roman",
    bodyFont: "Times New Roman",
    backgroundColor: "FFFFFF",
    surfaceColor: "FFFFFF",
    surfaceAltColor: "F8FAFC",
    titleColor: "111111",
    bodyColor: "222222",
    mutedColor: "555555",
    accentColor: "334155",
    accentDarkColor: "1E293B",
    accentSoftColor: "F1F5F9"
  }
};

const SLIDE_LAYOUT_KEYS = ["balanced", "visual-focus", "metrics-grid", "section-break", "quote"];

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

function parseJsonPayload(payloadText, fieldName) {
  try {
    return JSON.parse(payloadText);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function inspectPptxTokens(buffer, delimiters) {
  const zip = new PizZip(buffer.toString("binary"));
  const tokenRegex = new RegExp(
    `${escapeRegExp(delimiters.start)}\\s*([A-Za-z0-9_.:-]+)\\s*${escapeRegExp(delimiters.end)}`,
    "g"
  );

  const allTokens = new Set();
  const filesWithTokenHits = [];
  let scannedXmlFiles = 0;

  for (const fileName of Object.keys(zip.files)) {
    if (!/^ppt\/(slides|slideLayouts|slideMasters|notesSlides|notesMasters)\/.*\.xml$/i.test(fileName)) {
      continue;
    }

    const file = zip.file(fileName);
    if (!file) {
      continue;
    }

    scannedXmlFiles += 1;

    const xml = file.asText();
    const plainText = xml.replace(/<[^>]*>/g, "");

    const fileTokens = new Set();
    for (const match of plainText.matchAll(tokenRegex)) {
      const token = match[1]?.trim();
      if (token) {
        allTokens.add(token);
        fileTokens.add(token);
      }
    }

    if (fileTokens.size > 0) {
      filesWithTokenHits.push({
        file: fileName,
        tokens: Array.from(fileTokens).sort()
      });
    }
  }

  return {
    tokens: Array.from(allTokens).sort(),
    filesWithTokenHits,
    scannedXmlFiles
  };
}

function visualThemeFromPreset(preset) {
  return defaultVisualTheme({
    background: preset.backgroundColor,
    surface: preset.surfaceColor,
    ink: preset.titleColor,
    muted: preset.mutedColor,
    accent: preset.accentColor,
    accentSoft: preset.accentSoftColor
  });
}

async function resolveSlideVisual(slideInput, preset, outputPath, slideNumber) {
  if (slideInput.visual_svg_path) {
    return {
      outputPath: resolveUserPath(slideInput.visual_svg_path),
      kind: null,
      generated: false
    };
  }

  if (!slideInput.visual) {
    return null;
  }

  const absoluteOutputPath = resolveUserPath(outputPath);
  const assetPath = path.join(`${absoluteOutputPath}.assets`, `slide-${slideNumber}-${slideInput.visual.kind}.svg`);
  const written = await writeBusinessSvg(assetPath, {
    kind: slideInput.visual.kind,
    title: slideInput.visual.title ?? slideInput.title,
    subtitle: slideInput.visual.subtitle ?? slideInput.body ?? "",
    footer: slideInput.visual.footer ?? slideInput.section_label ?? "",
    width: slideInput.visual.width ?? 1600,
    height: slideInput.visual.height ?? 900,
    items: slideInput.visual.items ?? slideInput.bullets ?? [],
    theme: visualThemeFromPreset(preset)
  });

  return {
    outputPath: written.outputPath,
    kind: written.kind,
    generated: true
  };
}

function addSlideBackdrop(slide, preset) {
  slide.background = { color: preset.backgroundColor };
  slide.addShape(PPTX_SHAPES.rect, {
    x: 0,
    y: 0,
    w: 13.33,
    h: 0.18,
    fill: { color: preset.accentColor },
    line: { color: preset.accentColor, pt: 0 }
  });
  slide.addShape(PPTX_SHAPES.rect, {
    x: 0,
    y: 0.18,
    w: 13.33,
    h: 0.12,
    fill: { color: preset.accentSoftColor, transparency: 55 },
    line: { color: preset.accentSoftColor, pt: 0 }
  });
  slide.addShape(PPTX_SHAPES.ellipse, {
    x: 10.2,
    y: -0.65,
    w: 3.4,
    h: 2.55,
    fill: { color: preset.accentSoftColor, transparency: 35 },
    line: { color: preset.accentSoftColor, pt: 0 }
  });
  slide.addShape(PPTX_SHAPES.ellipse, {
    x: -0.8,
    y: 5.85,
    w: 3.0,
    h: 2.0,
    fill: { color: preset.surfaceAltColor, transparency: 25 },
    line: { color: preset.surfaceAltColor, pt: 0 }
  });
}

function addSurfaceCard(slide, preset, { x, y, w, h, fillColor = preset.surfaceColor, lineColor = preset.accentSoftColor }) {
  slide.addShape(PPTX_SHAPES.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: fillColor, transparency: 0 },
    line: { color: lineColor, pt: 0.9 }
  });
}

function addSectionLabel(slide, preset, label, x, y, w = 4.8) {
  if (!label) {
    return;
  }

  slide.addText(String(label).toUpperCase(), {
    x,
    y,
    w,
    h: 0.24,
    fontFace: preset.bodyFont,
    fontSize: 10,
    bold: true,
    color: preset.accentColor,
    charSpace: 1.3
  });
}

function addSlideFooter(slide, preset, slideNumber) {
  addSurfaceCard(slide, preset, {
    x: 11.95,
    y: 6.94,
    w: 0.92,
    h: 0.33,
    fillColor: preset.surfaceColor,
    lineColor: preset.accentSoftColor
  });
  slide.addText(String(slideNumber).padStart(2, "0"), {
    x: 12.08,
    y: 7.01,
    w: 0.66,
    h: 0.12,
    fontFace: preset.bodyFont,
    fontSize: 8.5,
    bold: true,
    color: preset.mutedColor,
    align: "center"
  });
}

function addMetricCards(slide, preset, metrics, x, y, width) {
  const visibleMetrics = (metrics ?? []).slice(0, 4);
  if (visibleMetrics.length === 0) {
    return 0;
  }

  const gap = 0.18;
  const cardWidth = (width - gap * (visibleMetrics.length - 1)) / visibleMetrics.length;
  visibleMetrics.forEach((metric, index) => {
    const cardX = x + index * (cardWidth + gap);
    addSurfaceCard(slide, preset, {
      x: cardX,
      y,
      w: cardWidth,
      h: 1.02,
      fillColor: index % 2 === 0 ? preset.surfaceColor : preset.surfaceAltColor
    });
    slide.addText(metric.value, {
      x: cardX + 0.18,
      y: y + 0.14,
      w: cardWidth - 0.36,
      h: 0.34,
      fontFace: preset.headingFont,
      fontSize: 19,
      bold: true,
      color: preset.titleColor
    });
    slide.addText(metric.label, {
      x: cardX + 0.18,
      y: y + 0.54,
      w: cardWidth - 0.36,
      h: 0.2,
      fontFace: preset.bodyFont,
      fontSize: 10.5,
      color: preset.mutedColor
    });
  });

  return 1.14;
}

function addBulletBlock(slide, preset, bullets, { x, y, w, h, fontSize = 15, fillColor = preset.surfaceColor }) {
  if (!bullets?.length) {
    return;
  }

  addSurfaceCard(slide, preset, { x, y, w, h, fillColor });
  const bulletText = bullets.slice(0, 6).map((entry) => `• ${entry}`).join("\n");
  slide.addText(bulletText, {
    x: x + 0.24,
    y: y + 0.24,
    w: w - 0.44,
    h: h - 0.34,
    fontFace: preset.bodyFont,
    fontSize,
    color: preset.bodyColor,
    valign: "top",
    breakLine: true,
    margin: 1
  });
}

function addBodyText(slide, preset, text, { x, y, w, h, fontSize = 17, color = preset.bodyColor }) {
  if (!text) {
    return;
  }

  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontFace: preset.bodyFont,
    fontSize,
    color,
    valign: "top",
    margin: 0
  });
}

function addVisualCard(slide, preset, slideVisual, x, y, w, h) {
  addSurfaceCard(slide, preset, {
    x: x - 0.06,
    y: y - 0.06,
    w: w + 0.12,
    h: h + 0.12,
    fillColor: preset.surfaceColor
  });
  slide.addImage({
    path: slideVisual.outputPath,
    x,
    y,
    w,
    h
  });
}

function resolveSlideLayout(slideInput, slideVisual) {
  if (slideInput.layout) {
    return slideInput.layout;
  }
  if ((slideInput.metrics?.length ?? 0) >= 3) {
    return "metrics-grid";
  }
  if (slideInput.accent_text && !slideVisual && (slideInput.bullets?.length ?? 0) <= 2) {
    return "quote";
  }
  if (slideVisual) {
    return "visual-focus";
  }
  return "balanced";
}

function finalizeSlide(slide, preset, slideInput, slideNumber) {
  addSlideFooter(slide, preset, slideNumber);
  if (slideInput.notes) {
    slide.addNotes(slideInput.notes);
  }
}

function addDeckTitleSlide(pptx, preset, title, subtitle) {
  const slide = pptx.addSlide();
  addSlideBackdrop(slide, preset);

  slide.addShape(PPTX_SHAPES.rect, {
    x: 0,
    y: 0,
    w: 2.05,
    h: 7.5,
    fill: { color: preset.accentDarkColor },
    line: { color: preset.accentDarkColor, pt: 0 }
  });
  slide.addShape(PPTX_SHAPES.roundRect, {
    x: 9.15,
    y: 4.58,
    w: 3.25,
    h: 1.58,
    rectRadius: 0.09,
    fill: { color: preset.surfaceColor },
    line: { color: preset.accentSoftColor, pt: 1 }
  });
  slide.addText("PRESENTATION", {
    x: 0.52,
    y: 0.78,
    w: 1.05,
    h: 2.8,
    rotate: 90,
    fontFace: preset.bodyFont,
    fontSize: 14,
    bold: true,
    color: "FFFFFF",
    charSpace: 2.4,
    align: "center"
  });
  slide.addText(title, {
    x: 2.55,
    y: 1.45,
    w: 8.45,
    h: 1.3,
    fontFace: preset.headingFont,
    fontSize: 33,
    bold: true,
    color: preset.titleColor,
    valign: "middle"
  });

  if (subtitle) {
    addBodyText(slide, preset, subtitle, {
      x: 2.62,
      y: 2.74,
      w: 7.2,
      h: 1.1,
      fontSize: 18,
      color: preset.mutedColor
    });
  }

  slide.addShape(PPTX_SHAPES.line, {
    x: 2.58,
    y: 5.9,
    w: 3.65,
    h: 0,
    line: {
      color: preset.accentColor,
      pt: 2.2
    }
  });
  slide.addText("Crafted with pptx-studio", {
    x: 2.65,
    y: 6.02,
    w: 3.6,
    h: 0.2,
    fontFace: preset.bodyFont,
    fontSize: 10,
    color: preset.mutedColor,
    charSpace: 0.8
  });
}

function addBalancedSlide(pptx, preset, slideInput, slideNumber, slideVisual) {
  const slide = pptx.addSlide();
  addSlideBackdrop(slide, preset);
  addSectionLabel(slide, preset, slideInput.section_label, 0.82, 0.48);

  const hasVisual = Boolean(slideVisual);
  const visualOnLeft = hasVisual && slideInput.visual_side === "left";
  const visualX = visualOnLeft ? 0.86 : 7.18;
  const textX = visualOnLeft ? 6.84 : 0.86;
  const textWidth = hasVisual ? 5.28 : 7.95;
  let cursorY = 0.84;

  slide.addText(slideInput.title, {
    x: textX,
    y: cursorY,
    w: textWidth,
    h: 0.72,
    fontFace: preset.headingFont,
    fontSize: 25,
    bold: true,
    color: preset.titleColor,
    valign: "middle"
  });
  cursorY += 0.82;

  cursorY += addMetricCards(slide, preset, slideInput.metrics, textX, cursorY, textWidth);

  if (slideInput.body) {
    addSurfaceCard(slide, preset, {
      x: textX,
      y: cursorY,
      w: textWidth,
      h: 1.14,
      fillColor: preset.surfaceColor
    });
    addBodyText(slide, preset, slideInput.body, {
      x: textX + 0.22,
      y: cursorY + 0.2,
      w: textWidth - 0.4,
      h: 0.78,
      fontSize: 16.2
    });
    cursorY += 1.26;
  }

  addBulletBlock(slide, preset, slideInput.bullets, {
    x: textX,
    y: cursorY,
    w: textWidth,
    h: hasVisual ? 2.55 : 3.1,
    fontSize: 15.2,
    fillColor: preset.surfaceAltColor
  });

  if (slideVisual) {
    addVisualCard(slide, preset, slideVisual, visualX, 1.45, 5.2, 4.45);
  } else if (slideInput.accent_text) {
    addSurfaceCard(slide, preset, {
      x: 9.25,
      y: 1.52,
      w: 3.25,
      h: 3.82,
      fillColor: preset.surfaceAltColor,
      lineColor: preset.accentColor
    });
    slide.addText(slideInput.accent_text, {
      x: 9.52,
      y: 1.86,
      w: 2.72,
      h: 3.06,
      fontFace: preset.bodyFont,
      fontSize: 17,
      color: preset.bodyColor,
      breakLine: true,
      margin: 1
    });
  }

  finalizeSlide(slide, preset, slideInput, slideNumber);
}

function addVisualFocusSlide(pptx, preset, slideInput, slideNumber, slideVisual) {
  const slide = pptx.addSlide();
  addSlideBackdrop(slide, preset);
  addSectionLabel(slide, preset, slideInput.section_label, 0.82, 0.46);

  const visualOnLeft = slideInput.visual_side === "left";
  const visualX = visualOnLeft ? 0.84 : 5.72;
  const textX = visualOnLeft ? 7.22 : 0.88;

  slide.addText(slideInput.title, {
    x: textX,
    y: 0.82,
    w: 5.18,
    h: 0.72,
    fontFace: preset.headingFont,
    fontSize: 24,
    bold: true,
    color: preset.titleColor
  });

  if (slideInput.body) {
    addBodyText(slide, preset, slideInput.body, {
      x: textX,
      y: 1.62,
      w: 5.06,
      h: 0.9,
      fontSize: 16.2
    });
  }

  addMetricCards(slide, preset, slideInput.metrics, textX, 2.42, 5.02);
  addBulletBlock(slide, preset, slideInput.bullets, {
    x: textX,
    y: 3.72,
    w: 5.08,
    h: 2.48,
    fontSize: 14.8,
    fillColor: preset.surfaceColor
  });
  addVisualCard(slide, preset, slideVisual, visualX, 1.2, 5.9, 4.95);

  finalizeSlide(slide, preset, slideInput, slideNumber);
}

function addMetricsGridSlide(pptx, preset, slideInput, slideNumber, slideVisual) {
  const slide = pptx.addSlide();
  addSlideBackdrop(slide, preset);
  addSectionLabel(slide, preset, slideInput.section_label, 0.82, 0.44);

  slide.addText(slideInput.title, {
    x: 0.84,
    y: 0.78,
    w: 8.3,
    h: 0.72,
    fontFace: preset.headingFont,
    fontSize: 24,
    bold: true,
    color: preset.titleColor
  });
  addBodyText(slide, preset, slideInput.body, {
    x: 0.86,
    y: 1.56,
    w: 7.3,
    h: 0.82,
    fontSize: 15.8,
    color: preset.mutedColor
  });
  addMetricCards(slide, preset, slideInput.metrics, 0.86, 2.34, 11.62);

  addBulletBlock(slide, preset, slideInput.bullets, {
    x: 0.86,
    y: 3.78,
    w: slideVisual ? 5.5 : 8.25,
    h: 2.12,
    fontSize: 14.8,
    fillColor: preset.surfaceAltColor
  });

  if (slideVisual) {
    addVisualCard(slide, preset, slideVisual, 7.15, 3.38, 5.1, 2.96);
  } else if (slideInput.accent_text) {
    addSurfaceCard(slide, preset, {
      x: 9.4,
      y: 3.76,
      w: 2.95,
      h: 2.14,
      fillColor: preset.surfaceColor,
      lineColor: preset.accentColor
    });
    slide.addText(slideInput.accent_text, {
      x: 9.62,
      y: 4.02,
      w: 2.5,
      h: 1.68,
      fontFace: preset.bodyFont,
      fontSize: 15,
      color: preset.bodyColor,
      breakLine: true,
      margin: 1
    });
  }

  finalizeSlide(slide, preset, slideInput, slideNumber);
}

function addSectionBreakSlide(pptx, preset, slideInput, slideNumber) {
  const slide = pptx.addSlide();
  addSlideBackdrop(slide, preset);

  slide.addShape(PPTX_SHAPES.rect, {
    x: 0,
    y: 0,
    w: 13.33,
    h: 7.5,
    fill: { color: preset.backgroundColor },
    line: { color: preset.backgroundColor, pt: 0 }
  });
  slide.addShape(PPTX_SHAPES.rect, {
    x: 0,
    y: 0,
    w: 4.2,
    h: 7.5,
    fill: { color: preset.accentDarkColor },
    line: { color: preset.accentDarkColor, pt: 0 }
  });
  addSectionLabel(slide, preset, slideInput.section_label ?? "section", 4.7, 1.5, 4.2);
  slide.addText(slideInput.title, {
    x: 4.7,
    y: 1.88,
    w: 6.8,
    h: 1.18,
    fontFace: preset.headingFont,
    fontSize: 31,
    bold: true,
    color: preset.titleColor
  });
  addBodyText(slide, preset, slideInput.body ?? slideInput.accent_text, {
    x: 4.74,
    y: 3.18,
    w: 5.7,
    h: 1.16,
    fontSize: 18,
    color: preset.mutedColor
  });

  if (slideInput.bullets?.length) {
    addBulletBlock(slide, preset, slideInput.bullets, {
      x: 4.7,
      y: 4.62,
      w: 4.95,
      h: 1.62,
      fontSize: 14.4,
      fillColor: preset.surfaceColor
    });
  }

  finalizeSlide(slide, preset, slideInput, slideNumber);
}

function addQuoteSlide(pptx, preset, slideInput, slideNumber) {
  const slide = pptx.addSlide();
  addSlideBackdrop(slide, preset);
  addSectionLabel(slide, preset, slideInput.section_label, 0.9, 0.66);
  slide.addText(slideInput.title, {
    x: 0.9,
    y: 1.02,
    w: 8.5,
    h: 0.56,
    fontFace: preset.headingFont,
    fontSize: 22,
    bold: true,
    color: preset.titleColor
  });
  addSurfaceCard(slide, preset, {
    x: 1.0,
    y: 1.78,
    w: 9.8,
    h: 3.4,
    fillColor: preset.surfaceAltColor,
    lineColor: preset.accentColor
  });
  slide.addText(`“${slideInput.accent_text ?? slideInput.body ?? slideInput.title}”`, {
    x: 1.36,
    y: 2.28,
    w: 9.1,
    h: 2.1,
    fontFace: preset.headingFont,
    fontSize: 24,
    color: preset.titleColor,
    italic: true,
    bold: true,
    breakLine: true,
    margin: 0
  });
  if (slideInput.quote_attribution) {
    slide.addText(slideInput.quote_attribution, {
      x: 1.4,
      y: 4.6,
      w: 6.5,
      h: 0.24,
      fontFace: preset.bodyFont,
      fontSize: 12,
      color: preset.mutedColor
    });
  }
  addBulletBlock(slide, preset, slideInput.bullets, {
    x: 11.0,
    y: 1.84,
    w: 1.9,
    h: 3.36,
    fontSize: 12.5,
    fillColor: preset.surfaceColor
  });
  finalizeSlide(slide, preset, slideInput, slideNumber);
}

function addContentSlide(pptx, preset, slideInput, slideIndex, slideVisual) {
  const layout = resolveSlideLayout(slideInput, slideVisual);

  if (layout === "section-break") {
    addSectionBreakSlide(pptx, preset, slideInput, slideIndex);
    return;
  }

  if (layout === "quote") {
    addQuoteSlide(pptx, preset, slideInput, slideIndex);
    return;
  }

  if (layout === "metrics-grid") {
    addMetricsGridSlide(pptx, preset, slideInput, slideIndex, slideVisual);
    return;
  }

  if (layout === "visual-focus" && slideVisual) {
    addVisualFocusSlide(pptx, preset, slideInput, slideIndex, slideVisual);
    return;
  }

  addBalancedSlide(pptx, preset, slideInput, slideIndex, slideVisual);
}

const server = new McpServer({
  name: "pptx-studio",
  version: "1.2.0"
});

server.tool(
  "pptx_create_styled_deck",
  "Create a more polished PPTX deck from structured slide definitions, richer layout variants, optional metric cards, and SVG visuals.",
  {
    output_path: z.string().min(1).describe("Destination path for generated .pptx file."),
    title: z.string().min(1).nullable().optional().describe("Optional deck title used for title slide + metadata."),
    subtitle: z.string().min(1).nullable().optional().describe("Optional deck subtitle."),
    author: z.string().min(1).nullable().optional().describe("Optional author metadata."),
    company: z.string().min(1).nullable().optional().describe("Optional company metadata."),
    style_preset: z
      .enum(["modern-product", "investor-clean", "academic-minimal"])
      .nullable()
      .optional()
      .describe("Visual preset for deck typography and palette."),
    include_title_slide: z.boolean().nullable().optional().describe("Whether to prepend a dedicated title slide."),
    slides: z
      .array(
        z.object({
          title: z.string().min(1),
          layout: z.enum(SLIDE_LAYOUT_KEYS).nullable().optional(),
          section_label: z.string().min(1).nullable().optional(),
          body: z.string().min(1).nullable().optional(),
          bullets: z.array(z.string().min(1)).nullable().optional(),
          accent_text: z.string().min(1).nullable().optional(),
          quote_attribution: z.string().min(1).nullable().optional(),
          notes: z.string().min(1).nullable().optional(),
          metrics: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).max(4).nullable().optional(),
          visual_side: z.enum(["left", "right"]).nullable().optional(),
          visual_svg_path: z.string().min(1).nullable().optional(),
          visual: VISUAL_SPEC_SCHEMA.nullable().optional()
        })
      )
      .min(1)
      .describe("Ordered slide content definitions.")
  },
  async ({ output_path, title, subtitle, author, company, style_preset, include_title_slide, slides }) => {
    const presetKey = style_preset ?? "modern-product";
    const preset = DECK_PRESETS[presetKey];

    const pptx = new PptxGenJS();
    pptx.layout = preset.layout;
    pptx.theme = {
      headFontFace: preset.headingFont,
      bodyFontFace: preset.bodyFont
    };
    pptx.author = author ?? "Meowbert";
    pptx.company = company ?? "";
    pptx.subject = `Generated by pptx-studio (${presetKey})`;
    pptx.title = title ?? "Generated Deck";

    const shouldIncludeTitleSlide = include_title_slide ?? true;
    if (shouldIncludeTitleSlide) {
      addDeckTitleSlide(pptx, preset, title ?? "Presentation", subtitle ?? "");
    }

    const generatedAssets = [];
    const slideLayouts = [];
    for (const [index, slideInput] of slides.entries()) {
      const slideVisual = await resolveSlideVisual(slideInput, preset, output_path, index + 1);
      if (slideVisual?.generated) {
        generatedAssets.push(slideVisual.outputPath);
      }
      const slideNumber = index + 1 + (shouldIncludeTitleSlide ? 1 : 0);
      slideLayouts.push(resolveSlideLayout(slideInput, slideVisual));
      addContentSlide(pptx, preset, slideInput, slideNumber, slideVisual);
    }

    const rendered = await pptx.write({
      outputType: "nodebuffer",
      compression: true
    });

    const outputBuffer = Buffer.isBuffer(rendered) ? rendered : Buffer.from(rendered);
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
              title_slide_included: shouldIncludeTitleSlide,
              generated_slide_count: slides.length + (shouldIncludeTitleSlide ? 1 : 0),
              slide_layouts: slideLayouts,
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
  "pptx_draw_slide_svg",
  "Create a detailed SVG visual for a slide so decks can include richer diagrams instead of plain text boxes.",
  {
    output_path: z.string().min(1).describe("Destination path for generated .svg file."),
    style_preset: z
      .enum(["modern-product", "investor-clean", "academic-minimal"])
      .nullable()
      .optional()
      .describe("Optional palette preset used for the SVG."),
    kind: z.enum(VISUAL_KIND_KEYS).describe("Visual layout to render."),
    title: z.string().min(1).describe("Visual title."),
    subtitle: z.string().min(1).nullable().optional().describe("Optional supporting subtitle."),
    footer: z.string().min(1).nullable().optional().describe("Optional footer or source note."),
    width: z.number().int().positive().nullable().optional().describe("Optional SVG width, default 1600."),
    height: z.number().int().positive().nullable().optional().describe("Optional SVG height, default 900."),
    items: z.array(VISUAL_ITEM_SCHEMA).min(1).describe("Structured items shown inside the visual.")
  },
  async ({ output_path, style_preset, kind, title, subtitle, footer, width, height, items }) => {
    const presetKey = style_preset ?? "modern-product";
    const written = await writeBusinessSvg(output_path, {
      kind,
      title,
      subtitle: subtitle ?? "",
      footer: footer ?? "",
      width: width ?? 1600,
      height: height ?? 900,
      items,
      theme: visualThemeFromPreset(DECK_PRESETS[presetKey])
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
  "pptx_fill_template",
  "Fill a PPTX template using JSON payload data and configurable delimiters.",
  {
    template_path: z.string().min(1).describe("Path to input template .pptx file."),
    output_path: z.string().min(1).describe("Path for rendered .pptx output."),
    data_json: z.string().min(2).describe("JSON object string used for template variables."),
    start_delimiter: z.string().min(1).nullable().optional().describe("Template start delimiter, default {."),
    end_delimiter: z.string().min(1).nullable().optional().describe("Template end delimiter, default }."),
    paragraph_loop: z.boolean().nullable().optional().describe("Enable paragraph loop processing."),
    linebreaks: z.boolean().nullable().optional().describe("Convert line breaks to PPTX line breaks.")
  },
  async ({ template_path, output_path, data_json, start_delimiter, end_delimiter, paragraph_loop, linebreaks }) => {
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
      throw new Error(`pptx_fill_template failed: ${safeDocxtemplaterError(error)}`);
    }
  }
);

server.tool(
  "pptx_inspect_placeholders",
  "Inspect placeholder tokens in a PPTX template based on delimiter scanning.",
  {
    template_path: z.string().min(1).describe("Path to input .pptx file."),
    start_delimiter: z.string().min(1).nullable().optional().describe("Start delimiter for template tokens."),
    end_delimiter: z.string().min(1).nullable().optional().describe("End delimiter for template tokens.")
  },
  async ({ template_path, start_delimiter, end_delimiter }) => {
    const { absolutePath: absoluteTemplatePath, data: templateBuffer } = await readBinaryFile(template_path);

    const delimiters = {
      start: start_delimiter ?? "{",
      end: end_delimiter ?? "}"
    };

    const inspection = inspectPptxTokens(templateBuffer, delimiters);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              template_path: absoluteTemplatePath,
              delimiters,
              tokens: inspection.tokens,
              files_with_hits: inspection.filesWithTokenHits,
              counts: {
                token_count: inspection.tokens.length,
                files_with_hits: inspection.filesWithTokenHits.length,
                scanned_xml_files: inspection.scannedXmlFiles
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
  "pptx_replace_text",
  "Replace literal text inside an existing PPTX deck while keeping the surrounding slide layout intact.",
  {
    source_path: z.string().min(1).describe("Path to the source .pptx file."),
    output_path: z.string().min(1).describe("Path for the edited .pptx output."),
    replacements: z
      .array(TEXT_REPLACEMENT_SCHEMA)
      .min(1)
      .describe("Literal find/replace operations applied paragraph by paragraph across slide text.")
  },
  async ({ source_path, output_path, replacements }) => {
    const { absolutePath: absoluteSourcePath, data: sourceBuffer } = await readBinaryFile(source_path);
    const edited = replaceTextInPptxBuffer(sourceBuffer, replacements);
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
  "pptx_render_pdf",
  "Convert a PPTX/POTX deck to PDF so an agent can preview the whole deck or a slide range with view_pdf_file.",
  {
    source_path: z.string().min(1).describe("Path to the source .pptx/.potx file."),
    output_path: z.string().min(1).describe("Destination path for the rendered .pdf file."),
    start_page: z.number().int().positive().nullable().optional().describe("Optional first slide number to export."),
    end_page: z.number().int().positive().nullable().optional().describe("Optional last slide number to export.")
  },
  async ({ source_path, output_path, start_page, end_page }) => {
    const rendered = await convertOfficeDocumentToPdf({
      inputPath: source_path,
      outputPath: output_path,
      exportFilter: "impress_pdf_Export",
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
  "pptx_find_templates",
  "Search the web for PPTX/POTX templates that can be downloaded and reused.",
  {
    query: z.string().min(1).describe("Search phrase describing the template you want."),
    limit: z.number().int().positive().max(10).nullable().optional().describe("Maximum number of results to return.")
  },
  async ({ query, limit }) => {
    const search = await searchTemplateCatalog({
      query,
      extensions: ["pptx", "potx"],
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
              supported_extensions: [".pptx", ".potx"]
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
  "pptx_get_template",
  "Download a PPTX/POTX template from a direct link or from a web page that exposes template files.",
  {
    url: z.string().url().describe("Direct file URL or template page URL."),
    output_path: z.string().min(1).describe("Destination path for the downloaded template."),
    allow_page_link_discovery: z.boolean().nullable().optional().describe("When true, scan HTML pages for .pptx/.potx links.")
  },
  async ({ url, output_path, allow_page_link_discovery }) => {
    const downloaded = await fetchTemplateToPath({
      url,
      outputPath: output_path,
      extensions: ["pptx", "potx"],
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
