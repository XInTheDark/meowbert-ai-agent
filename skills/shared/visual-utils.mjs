import fs from "node:fs/promises";
import path from "node:path";
import { resolveTaskScopedUserPath } from "./task-path-utils.mjs";

const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4B3ioAAAAASUVORK5CYII=";

const VISUAL_KINDS = ["process", "roadmap", "comparison", "scorecard", "architecture", "ecosystem"];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function chunkText(text, maxCharsPerLine, maxLines) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) {
    return [];
  }

  const words = source.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word.slice(0, maxCharsPerLine));
      current = word.slice(maxCharsPerLine);
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = `${lines[lastIndex].slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd()}...`;
  }

  return lines;
}

function renderTextBlock(lines, options) {
  const {
    x,
    y,
    fill,
    fontSize,
    lineHeight,
    fontWeight = 400,
    textAnchor = "start",
    opacity = 1,
    letterSpacing = 0,
    fontFamily = "Inter, Aptos, Calibri, Arial, sans-serif"
  } = options;

  if (!lines.length) {
    return "";
  }

  const safeText = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : lineHeight;
      return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${textAnchor}" opacity="${opacity}" letter-spacing="${letterSpacing}" font-family="${fontFamily}">${safeText}</text>`;
}

function normalizeColor(hex, fallback) {
  const value = String(hex ?? "").replace(/[^0-9A-Fa-f]/g, "");
  if (value.length === 6) {
    return `#${value}`;
  }
  return fallback;
}

function rgba(hex, alpha) {
  const value = normalizeColor(hex, "#000000").slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function normalizeVisualItem(item, index) {
  if (typeof item === "string") {
    return {
      label: `0${index + 1}`,
      title: item,
      body: "",
      value: ""
    };
  }

  return {
    label: String(item?.label ?? `${index + 1}`),
    title: String(item?.title ?? item?.value ?? item?.body ?? `Item ${index + 1}`),
    body: String(item?.body ?? ""),
    value: String(item?.value ?? "")
  };
}

function normalizeVisualItems(items) {
  return (items ?? []).slice(0, 6).map((item, index) => normalizeVisualItem(item, index));
}

function renderCardFrame({ x, y, width, height, radius, fill, stroke, shadowId }) {
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" filter="url(#${shadowId})" />`
  ].join("");
}

function renderProcessVisual({ width, height, theme, items }) {
  const cardCount = Math.max(3, Math.min(items.length || 3, 4));
  const safeItems = items.length
    ? items.slice(0, cardCount)
    : Array.from({ length: cardCount }, (_, index) => normalizeVisualItem(null, index));
  const gutter = 28;
  const cardWidth = (width - gutter * (cardCount + 1)) / cardCount;
  const cardHeight = 290;
  const top = 240;

  const cards = safeItems.map((item, index) => {
    const x = gutter + index * (cardWidth + gutter);
    const numberY = top + 46;
    const titleY = top + 108;
    const bodyY = top + 162;
    const arrow =
      index < safeItems.length - 1
        ? `<path d="M ${x + cardWidth + 8} ${top + cardHeight / 2} L ${x + cardWidth + gutter - 20} ${top + cardHeight / 2}" stroke="${theme.accent}" stroke-width="6" stroke-linecap="round" />
         <path d="M ${x + cardWidth + gutter - 44} ${top + cardHeight / 2 - 18} L ${x + cardWidth + gutter - 20} ${top + cardHeight / 2} L ${x + cardWidth + gutter - 44} ${top + cardHeight / 2 + 18}" fill="none" stroke="${theme.accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />`
        : "";

    return [
      renderCardFrame({
        x,
        y: top,
        width: cardWidth,
        height: cardHeight,
        radius: 28,
        fill: theme.surface,
        stroke: rgba(theme.accent, 0.25),
        shadowId: "softShadow"
      }),
      `<circle cx="${x + 52}" cy="${top + 52}" r="28" fill="${theme.accentSoft}" />`,
      renderTextBlock([item.label], {
        x: x + 52,
        y: numberY,
        fill: theme.accent,
        fontSize: 24,
        fontWeight: 700,
        textAnchor: "middle"
      }),
      renderTextBlock(chunkText(item.title, 22, 2), {
        x: x + 34,
        y: titleY,
        fill: theme.ink,
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 34
      }),
      renderTextBlock(chunkText(item.body || item.value, 28, 4), {
        x: x + 34,
        y: bodyY,
        fill: theme.muted,
        fontSize: 20,
        lineHeight: 28
      }),
      arrow
    ].join("");
  });

  return cards.join("\n");
}

function renderRoadmapVisual({ width, theme, items }) {
  const safeItems = items.length
    ? items.slice(0, 5)
    : Array.from({ length: 4 }, (_, index) => normalizeVisualItem(null, index));
  const startX = 140;
  const endX = width - 140;
  const centerY = 395;
  const step = safeItems.length > 1 ? (endX - startX) / (safeItems.length - 1) : 0;

  const nodes = safeItems.map((item, index) => {
    const x = startX + step * index;
    const cardY = index % 2 === 0 ? 180 : 450;
    return [
      `<line x1="${x}" y1="${centerY}" x2="${x}" y2="${cardY + (index % 2 === 0 ? 128 : 0)}" stroke="${rgba(theme.accent, 0.35)}" stroke-width="4" stroke-dasharray="10 10" />`,
      `<circle cx="${x}" cy="${centerY}" r="24" fill="${theme.accent}" />`,
      renderCardFrame({
        x: x - 110,
        y: cardY,
        width: 220,
        height: 128,
        radius: 24,
        fill: theme.surface,
        stroke: rgba(theme.accent, 0.24),
        shadowId: "softShadow"
      }),
      renderTextBlock([item.label], {
        x,
        y: cardY + 34,
        fill: theme.accent,
        fontSize: 18,
        fontWeight: 700,
        textAnchor: "middle",
        letterSpacing: 1.4
      }),
      renderTextBlock(chunkText(item.title, 18, 2), {
        x,
        y: cardY + 68,
        fill: theme.ink,
        fontSize: 24,
        fontWeight: 700,
        textAnchor: "middle",
        lineHeight: 28
      }),
      renderTextBlock(chunkText(item.body || item.value, 20, 2), {
        x,
        y: cardY + 104,
        fill: theme.muted,
        fontSize: 18,
        textAnchor: "middle",
        lineHeight: 22
      })
    ].join("");
  });

  return [
    `<line x1="${startX}" y1="${centerY}" x2="${endX}" y2="${centerY}" stroke="${rgba(theme.accent, 0.28)}" stroke-width="10" stroke-linecap="round" />`,
    nodes.join("\n")
  ].join("\n");
}

function renderComparisonVisual({ width, theme, items }) {
  const safeItems = items.length
    ? items.slice(0, 3)
    : Array.from({ length: 3 }, (_, index) => normalizeVisualItem(null, index));
  const gutter = 30;
  const cardWidth = (width - 160 - gutter * (safeItems.length - 1)) / safeItems.length;
  const left = 80;
  const top = 210;

  return safeItems
    .map((item, index) => {
      const x = left + index * (cardWidth + gutter);
      const bullets = (item.body || item.value)
        .split(/\s*\|\s*/)
        .filter(Boolean)
        .slice(0, 4);
      return [
        renderCardFrame({
          x,
          y: top,
          width: cardWidth,
          height: 400,
          radius: 30,
          fill: theme.surface,
          stroke: rgba(theme.accent, index === 1 ? 0.42 : 0.22),
          shadowId: "softShadow"
        }),
        `<rect x="${x}" y="${top}" width="${cardWidth}" height="72" rx="30" fill="${index === 1 ? theme.accentSoft : rgba(theme.accentSoft, 0.45)}" />`,
        renderTextBlock(chunkText(item.title, 18, 2), {
          x: x + 30,
          y: top + 46,
          fill: theme.ink,
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 30
        }),
        renderTextBlock(chunkText(item.label, 24, 1), {
          x: x + 30,
          y: top + 110,
          fill: theme.accent,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: 1.2
        }),
        bullets
          .map((bullet, bulletIndex) => {
            const y = top + 164 + bulletIndex * 64;
            return [
              `<circle cx="${x + 34}" cy="${y - 8}" r="8" fill="${theme.accent}" />`,
              renderTextBlock(chunkText(bullet, 24, 2), {
                x: x + 56,
                y,
                fill: theme.muted,
                fontSize: 20,
                lineHeight: 26
              })
            ].join("");
          })
          .join("\n")
      ].join("\n");
    })
    .join("\n");
}

function renderScorecardVisual({ width, theme, items }) {
  const safeItems = items.length
    ? items.slice(0, 4)
    : Array.from({ length: 4 }, (_, index) => normalizeVisualItem(null, index));
  const metricCardWidth = 260;
  const metricTop = 210;
  const metricGap = 22;
  const metricLeft = (width - metricCardWidth * safeItems.length - metricGap * (safeItems.length - 1)) / 2;

  const metrics = safeItems.map((item, index) => {
    const x = metricLeft + index * (metricCardWidth + metricGap);
    return [
      renderCardFrame({
        x,
        y: metricTop,
        width: metricCardWidth,
        height: 170,
        radius: 28,
        fill: theme.surface,
        stroke: rgba(theme.accent, 0.24),
        shadowId: "softShadow"
      }),
      renderTextBlock(chunkText(item.label, 18, 1), {
        x: x + 28,
        y: metricTop + 42,
        fill: theme.muted,
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: 1.2
      }),
      renderTextBlock(chunkText(item.value || item.title, 10, 1), {
        x: x + 28,
        y: metricTop + 96,
        fill: theme.ink,
        fontSize: 40,
        fontWeight: 800
      }),
      renderTextBlock(chunkText(item.body || item.title, 20, 2), {
        x: x + 28,
        y: metricTop + 132,
        fill: theme.muted,
        fontSize: 18,
        lineHeight: 22
      })
    ].join("\n");
  });

  const insights = safeItems.slice(0, 3).map((item, index) => {
    const y = 470 + index * 84;
    const barWidth = 360 + index * 80;
    return [
      renderTextBlock(chunkText(item.title, 20, 1), {
        x: 120,
        y,
        fill: theme.ink,
        fontSize: 24,
        fontWeight: 700
      }),
      `<rect x="120" y="${y + 20}" width="620" height="18" rx="9" fill="${rgba(theme.accent, 0.14)}" />`,
      `<rect x="120" y="${y + 20}" width="${barWidth}" height="18" rx="9" fill="${theme.accent}" />`,
      renderTextBlock(chunkText(item.body || item.value || item.label, 22, 2), {
        x: 780,
        y: y + 22,
        fill: theme.muted,
        fontSize: 18,
        lineHeight: 22
      })
    ].join("\n")
  });

  return `${metrics.join("\n")}\n${insights.join("\n")}`;
}

function renderArchitectureVisual({ width, theme, items }) {
  const safeItems = items.length
    ? items.slice(0, 4)
    : Array.from({ length: 4 }, (_, index) => normalizeVisualItem(null, index));
  const laneWidth = width - 240;
  const laneX = 120;
  const laneHeight = 96;
  const startY = 220;

  return safeItems
    .map((item, index) => {
      const y = startY + index * 116;
      return [
        `<rect x="${laneX}" y="${y}" width="${laneWidth}" height="${laneHeight}" rx="28" fill="${index % 2 === 0 ? theme.surface : rgba(theme.accentSoft, 0.6)}" stroke="${rgba(theme.accent, 0.2)}" stroke-width="1.5" filter="url(#softShadow)" />`,
        `<rect x="${laneX + 24}" y="${y + 22}" width="130" height="52" rx="18" fill="${theme.accentSoft}" />`,
        renderTextBlock(chunkText(item.label, 12, 1), {
          x: laneX + 89,
          y: y + 56,
          fill: theme.accent,
          fontSize: 20,
          fontWeight: 800,
          textAnchor: "middle"
        }),
        renderTextBlock(chunkText(item.title, 26, 1), {
          x: laneX + 188,
          y: y + 46,
          fill: theme.ink,
          fontSize: 28,
          fontWeight: 700
        }),
        renderTextBlock(chunkText(item.body || item.value, 52, 2), {
          x: laneX + 188,
          y: y + 78,
          fill: theme.muted,
          fontSize: 18,
          lineHeight: 22
        })
      ].join("\n");
    })
    .join("\n");
}

function renderEcosystemVisual({ width, height, theme, items }) {
  const safeItems = items.length
    ? items.slice(0, 5)
    : Array.from({ length: 5 }, (_, index) => normalizeVisualItem(null, index));
  const centerX = width / 2;
  const centerY = 430;
  const radius = 220;

  const center = [
    `<circle cx="${centerX}" cy="${centerY}" r="120" fill="${theme.accentSoft}" filter="url(#softShadow)" />`,
    renderTextBlock(chunkText("Core platform", 14, 2), {
      x: centerX,
      y: centerY - 8,
      fill: theme.accent,
      fontSize: 30,
      fontWeight: 800,
      textAnchor: "middle",
      lineHeight: 34
    })
  ].join("\n");

  const orbitNodes = safeItems.map((item, index) => {
    const angle = (Math.PI * 2 * index) / safeItems.length - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    return [
      `<line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" stroke="${rgba(theme.accent, 0.24)}" stroke-width="4" />`,
      `<rect x="${x - 122}" y="${y - 54}" width="244" height="108" rx="24" fill="${theme.surface}" stroke="${rgba(theme.accent, 0.22)}" stroke-width="1.5" filter="url(#softShadow)" />`,
      renderTextBlock(chunkText(item.title, 18, 2), {
        x,
        y: y - 6,
        fill: theme.ink,
        fontSize: 22,
        fontWeight: 700,
        textAnchor: "middle",
        lineHeight: 24
      }),
      renderTextBlock(chunkText(item.body || item.value || item.label, 20, 2), {
        x,
        y: y + 34,
        fill: theme.muted,
        fontSize: 16,
        textAnchor: "middle",
        lineHeight: 20
      })
    ].join("\n");
  });

  return `${center}\n${orbitNodes.join("\n")}`;
}

function renderVisualBody({ kind, width, height, theme, items }) {
  switch (kind) {
    case "roadmap":
      return renderRoadmapVisual({ width, theme, items });
    case "comparison":
      return renderComparisonVisual({ width, theme, items });
    case "scorecard":
      return renderScorecardVisual({ width, theme, items });
    case "architecture":
      return renderArchitectureVisual({ width, theme, items });
    case "ecosystem":
      return renderEcosystemVisual({ width, height, theme, items });
    case "process":
    default:
      return renderProcessVisual({ width, height, theme, items });
  }
}

export function defaultVisualTheme(overrides = {}) {
  return {
    background: normalizeColor(overrides.background, "#F8FAFC"),
    surface: normalizeColor(overrides.surface, "#FFFFFF"),
    ink: normalizeColor(overrides.ink, "#0F172A"),
    muted: normalizeColor(overrides.muted, "#475569"),
    accent: normalizeColor(overrides.accent, "#2563EB"),
    accentSoft: normalizeColor(overrides.accentSoft, "#DBEAFE")
  };
}

export function buildBusinessSvg(options = {}) {
  const kind = VISUAL_KINDS.includes(options.kind) ? options.kind : "process";
  const width = clamp(Number(options.width) || 1600, 640, 2400);
  const height = clamp(Number(options.height) || 900, 360, 1600);
  const theme = defaultVisualTheme(options.theme);
  const items = normalizeVisualItems(options.items);
  const title = String(options.title ?? "Visual overview").trim() || "Visual overview";
  const subtitle = String(options.subtitle ?? "").trim();
  const footer = String(options.footer ?? "").trim();

  const body = renderVisualBody({ kind, width, height, theme, items });
  const titleLines = chunkText(title, 34, 2);
  const subtitleLines = chunkText(subtitle, 80, 2);
  const footerLines = chunkText(footer, 72, 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="accentGlow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${theme.accentSoft}" />
      <stop offset="100%" stop-color="${rgba(theme.accent, 0.18)}" />
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="${rgba(theme.ink, 0.12)}" />
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${theme.background}" />
  <circle cx="${width - 120}" cy="${height - 120}" r="160" fill="url(#accentGlow)" opacity="0.9" />
  <circle cx="160" cy="140" r="90" fill="${rgba(theme.accentSoft, 0.5)}" />
  <rect x="72" y="74" width="${width - 144}" height="${height - 148}" rx="42" fill="${rgba(theme.surface, 0.96)}" stroke="${rgba(theme.accent, 0.1)}" stroke-width="2" />
  ${renderTextBlock(titleLines, {
    x: 120,
    y: 148,
    fill: theme.ink,
    fontSize: 54,
    fontWeight: 800,
    lineHeight: 58
  })}
  ${renderTextBlock(subtitleLines, {
    x: 120,
    y: 224,
    fill: theme.muted,
    fontSize: 24,
    lineHeight: 30
  })}
  ${body}
  ${footerLines.length ? renderTextBlock(footerLines, {
    x: width - 120,
    y: height - 72,
    fill: theme.muted,
    fontSize: 18,
    textAnchor: "end",
    lineHeight: 22
  }) : ""}
</svg>`;
}

export async function writeBusinessSvg(outputPath, options = {}) {
  const kind = VISUAL_KINDS.includes(options.kind) ? options.kind : "process";
  const absolutePath = resolveTaskScopedUserPath(outputPath);
  const svg = buildBusinessSvg(options);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, svg, "utf8");
  return {
    outputPath: absolutePath,
    svg,
    width: clamp(Number(options.width) || 1600, 640, 2400),
    height: clamp(Number(options.height) || 900, 360, 1600),
    kind
  };
}

export function createTransparentPngFallback() {
  return Buffer.from(TRANSPARENT_PNG_BASE64, "base64");
}

export const VISUAL_KIND_KEYS = VISUAL_KINDS;
