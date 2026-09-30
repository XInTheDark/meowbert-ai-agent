import type { ResponseInputItem } from "openai/resources/responses/responses";
import {
  isPlainObject,
  parseImageDimensionsFromBuffer,
  resolveContextWindowForModel,
  type ImageDimensions,
  type PlatformModelMetadata
} from "@meowbert/shared";
import { config } from "../../lib/config.js";

export { isPlainObject };

export function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

export function truncateWithOptionalLimit(value: string, limit: number | null): string {
  if (limit === null) {
    return value;
  }
  return truncate(value, limit);
}

export function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function estimateTokensFromText(text: string): number {
  if (!text) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 6));
}

type ImageDetailLevel = "low" | "high" | "auto";

const IMAGE_PATCH_SIZE = 32;
const IMAGE_PATCH_CAP = 1536;
const IMAGE_DETAIL_MAX_SIDE = 2048;
const IMAGE_DETAIL_TARGET_SHORT_SIDE = 768;
const IMAGE_DETAIL_TILE_SIZE = 512;
const UNKNOWN_IMAGE_TILE_FALLBACK = 12;

const PATCH_MODEL_MULTIPLIERS: Array<{ prefix: string; multiplier: number }> = [
  { prefix: "o4-mini", multiplier: 1.72 },
  { prefix: "gpt-4.1-mini", multiplier: 1.62 },
  { prefix: "gpt-4.1-nano", multiplier: 2.46 },
  { prefix: "gpt-5-mini", multiplier: 1.62 },
  { prefix: "gpt-5-nano", multiplier: 2.46 }
];

const imageDimensionCache = new Map<string, ImageDimensions | null>();

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

function modelStartsWith(model: string, prefix: string): boolean {
  return model === prefix || model.startsWith(`${prefix}-`);
}

function getPatchModelMultiplier(model: string): number | null {
  const normalizedModel = normalizeModelName(model);
  for (const entry of PATCH_MODEL_MULTIPLIERS) {
    if (modelStartsWith(normalizedModel, entry.prefix)) {
      return entry.multiplier;
    }
  }
  return null;
}

function getHighDetailTokenRates(model: string): { baseTokens: number; tileTokens: number } {
  const normalizedModel = normalizeModelName(model);

  if (modelStartsWith(normalizedModel, "gpt-5") || normalizedModel === "gpt-5-chat-latest") {
    return { baseTokens: 70, tileTokens: 140 };
  }

  if (modelStartsWith(normalizedModel, "gpt-4o-mini")) {
    return { baseTokens: 2833, tileTokens: 5667 };
  }

  if (
    modelStartsWith(normalizedModel, "o1")
    || modelStartsWith(normalizedModel, "o3")
  ) {
    return { baseTokens: 75, tileTokens: 150 };
  }

  if (modelStartsWith(normalizedModel, "computer-use-preview")) {
    return { baseTokens: 65, tileTokens: 129 };
  }

  if (
    modelStartsWith(normalizedModel, "gpt-4o")
    || modelStartsWith(normalizedModel, "gpt-4.1")
    || modelStartsWith(normalizedModel, "gpt-4.5")
    || modelStartsWith(normalizedModel, "cua")
    || modelStartsWith(normalizedModel, "o")
  ) {
    return { baseTokens: 85, tileTokens: 170 };
  }

  return { baseTokens: 85, tileTokens: 170 };
}

function resolveImageDetail(part: Record<string, unknown>): ImageDetailLevel {
  let detailValue: unknown = part.detail;
  if (!detailValue && isPlainObject(part.image_url)) {
    detailValue = part.image_url.detail;
  }

  if (typeof detailValue !== "string") {
    return "auto";
  }

  const normalized = detailValue.toLowerCase();
  if (normalized === "low" || normalized === "high") {
    return normalized;
  }

  if (normalized === "original") {
    return "high";
  }

  return "auto";
}

function resolveImageUrl(part: Record<string, unknown>): string | null {
  if (typeof part.image_url === "string") {
    return part.image_url;
  }

  if (isPlainObject(part.image_url) && typeof part.image_url.url === "string") {
    return part.image_url.url;
  }

  return null;
}

function decodeDataUrlImage(dataUrl: string): { mimeType: string | null; buffer: Buffer } | null {
  if (!dataUrl.startsWith("data:")) {
    return null;
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }

  const header = dataUrl.slice(5, commaIndex);
  if (!header.includes(";base64")) {
    return null;
  }

  const mimeType = header.split(";")[0] || null;
  const base64Data = dataUrl.slice(commaIndex + 1);
  try {
    return {
      mimeType,
      buffer: Buffer.from(base64Data, "base64")
    };
  } catch {
    return null;
  }
}

function getImageDimensions(imageUrl: string): ImageDimensions | null {
  if (imageDimensionCache.has(imageUrl)) {
    return imageDimensionCache.get(imageUrl) ?? null;
  }

  const decoded = decodeDataUrlImage(imageUrl);
  if (!decoded?.buffer) {
    imageDimensionCache.set(imageUrl, null);
    return null;
  }

  const dimensions = parseImageDimensionsFromBuffer(decoded.buffer);
  imageDimensionCache.set(imageUrl, dimensions);
  return dimensions;
}

function isDataUrl(value: string): boolean {
  return value.startsWith("data:");
}

function describeInlineDataUrl(value: string): string {
  const commaIndex = value.indexOf(",");
  const header = commaIndex >= 0 ? value.slice(5, commaIndex) : value.slice(5);
  const mimeType = header.split(";")[0]?.trim() || "application/octet-stream";
  return `[inline ${mimeType} omitted]`;
}

function summarizeInlineStringForEstimation(value: string): string {
  if (!isDataUrl(value)) {
    return value;
  }

  return describeInlineDataUrl(value);
}

function sanitizeValueForContextEstimation(value: unknown): unknown {
  if (typeof value === "string") {
    return summarizeInlineStringForEstimation(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValueForContextEstimation(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = sanitizeValueForContextEstimation(entry);
  }
  return sanitized;
}

function summarizeInputFilePart(part: Record<string, unknown>): string {
  const segments = ["[input_file]"];
  const filename = typeof part.filename === "string" ? part.filename : "";
  const fileUrl = typeof part.file_url === "string" ? part.file_url : "";
  const fileId = typeof part.file_id === "string" ? part.file_id : "";

  if (filename) {
    segments.push(`filename=${filename}`);
  }

  if (fileId) {
    segments.push(`file_id=${fileId}`);
  }

  if (fileUrl) {
    segments.push(`file_url=${summarizeInlineStringForEstimation(fileUrl)}`);
  }

  return segments.join(" ");
}

function summarizeInputImagePart(part: Record<string, unknown>, partType: string): string {
  const segments = [`[${partType}]`];
  const detail = resolveImageDetail(part);
  const imageUrl = resolveImageUrl(part);
  const dimensions = imageUrl ? getImageDimensions(imageUrl) : null;

  if (detail !== "auto") {
    segments.push(`detail=${detail}`);
  }

  if (dimensions) {
    segments.push(`size=${dimensions.width}x${dimensions.height}`);
  }

  if (imageUrl) {
    segments.push(`source=${isDataUrl(imageUrl) ? "inline_data_url" : imageUrl}`);
  }

  return segments.join(" ");
}

export function stringifyContextEstimateValue(value: unknown): string {
  if (typeof value === "string") {
    return summarizeInlineStringForEstimation(value);
  }

  if (isPlainObject(value)) {
    const partType = typeof value.type === "string" ? value.type : null;
    if (partType === "input_file") {
      return summarizeInputFilePart(value);
    }

    if (partType === "input_image" || partType === "image_url") {
      return summarizeInputImagePart(value, partType);
    }
  }

  return safeStringify(sanitizeValueForContextEstimation(value));
}

function estimatePatchModelImageTokens(dimensions: ImageDimensions, multiplier: number): number {
  const patchesWide = Math.ceil(dimensions.width / IMAGE_PATCH_SIZE);
  const patchesHigh = Math.ceil(dimensions.height / IMAGE_PATCH_SIZE);
  const rawPatchCount = patchesWide * patchesHigh;
  const cappedPatchCount = Math.min(rawPatchCount, IMAGE_PATCH_CAP);
  return Math.max(1, Math.ceil(cappedPatchCount * multiplier));
}

function estimateHighDetailImageTokens(
  dimensions: ImageDimensions,
  rates: { baseTokens: number; tileTokens: number }
): number {
  let width = dimensions.width;
  let height = dimensions.height;

  const maxSide = Math.max(width, height);
  if (maxSide > IMAGE_DETAIL_MAX_SIDE) {
    const scale = IMAGE_DETAIL_MAX_SIDE / maxSide;
    width *= scale;
    height *= scale;
  }

  const shortSide = Math.min(width, height);
  if (shortSide > 0) {
    const scale = IMAGE_DETAIL_TARGET_SHORT_SIDE / shortSide;
    width *= scale;
    height *= scale;
  }

  const tilesWide = Math.max(1, Math.ceil(width / IMAGE_DETAIL_TILE_SIZE));
  const tilesHigh = Math.max(1, Math.ceil(height / IMAGE_DETAIL_TILE_SIZE));
  return rates.baseTokens + (tilesWide * tilesHigh * rates.tileTokens);
}

function estimateImageTokens(part: Record<string, unknown>, model: string): number {
  const detail = resolveImageDetail(part);
  const imageUrl = resolveImageUrl(part);
  const dimensions = imageUrl ? getImageDimensions(imageUrl) : null;
  const patchModelMultiplier = getPatchModelMultiplier(model);

  if (patchModelMultiplier !== null) {
    if (dimensions) {
      return estimatePatchModelImageTokens(dimensions, patchModelMultiplier);
    }

    return Math.max(1, Math.ceil(IMAGE_PATCH_CAP * patchModelMultiplier));
  }

  const rates = getHighDetailTokenRates(model);
  if (detail === "low") {
    return rates.baseTokens;
  }

  if (!dimensions) {
    return rates.baseTokens + (rates.tileTokens * UNKNOWN_IMAGE_TILE_FALLBACK);
  }

  return estimateHighDetailImageTokens(dimensions, rates);
}

function estimateInputFileTokens(part: Record<string, unknown>): number {
  void part;
  return 0;
}

function estimateRoleContentTokens(content: unknown, model: string): number {
  if (typeof content === "string") {
    return estimateTokensFromText(content);
  }

  if (!Array.isArray(content)) {
    return estimateTokensFromText(stringifyContextEstimateValue(content));
  }

  return content.reduce((total, part) => {
    if (!isPlainObject(part)) {
      return total + estimateTokensFromText(stringifyContextEstimateValue(part));
    }

    const partType = typeof part.type === "string" ? part.type : null;
    if ((partType === "input_text" || partType === "output_text") && typeof part.text === "string") {
      return total + estimateTokensFromText(part.text);
    }

    if (partType === "input_image" || partType === "image_url") {
      return total + estimateImageTokens(part, model);
    }

    if (partType === "input_file") {
      return total + estimateInputFileTokens(part);
    }

    return total + estimateTokensFromText(stringifyContextEstimateValue(part));
  }, 0);
}

function estimateConversationItemTokens(item: ResponseInputItem, model: string): number {
  const record = item as unknown as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : null;

  if (role) {
    return estimateRoleContentTokens(record.content, model);
  }

  if (record.type === "compaction" && typeof record.encrypted_content === "string") {
    return estimateTokensFromText(record.encrypted_content);
  }

  return estimateTokensFromText(stringifyContextEstimateValue(item));
}

export function estimateContextTokens(
  systemPrompt: string,
  conversationItems: ResponseInputItem[],
  model: string = config.openai.defaultModel
): number {
  const systemTokens = estimateTokensFromText(systemPrompt) + 16;
  const inputTokens = conversationItems.reduce((total, item) => {
    return total + estimateConversationItemTokens(item, model) + 8;
  }, 0);

  return systemTokens + inputTokens;
}

export function getMaxContextWindowTokens(model: string, modelMetadata: PlatformModelMetadata): number {
  return resolveContextWindowForModel(model, modelMetadata);
}
