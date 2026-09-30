import { isWithinPath } from "../../packages/shared/src/path-containment.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveTaskPathBaseDir } from "../shared/task-path-utils.mjs";

const DEFAULT_MODEL = "gpt-image-2.5-sunburst";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const IMAGE_GENERATION_PATH = "/images/generations";
const IMAGE_EDIT_PATH = "/images/edits";
const DEFAULT_TIMEOUT_MS = 300_000;

const ProviderConfigSchema = z.object({
  provider: z.literal("openai").default("openai"),
  model: z.string().min(1).default(DEFAULT_MODEL),
  apiKey: z.string().min(1).optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  baseURL: z.string().url().default(DEFAULT_BASE_URL),
  headers: z.record(z.string()).default({}),
  name: z.string().min(1).optional(),
  maxRetries: z.number().int().min(0).max(10).default(2),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(DEFAULT_TIMEOUT_MS)
});

const ConfigSchema = z.object({
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  provider: ProviderConfigSchema.default({})
});

const GenerateImageInputSchema = {
  prompt: z.string().min(1).max(32_000).describe("Text description of the image to generate."),
  filename: z.string().min(1).describe("Output image filename. Relative paths resolve inside the current task directory."),
  model: z.string().min(1).optional().describe("Image model. Defaults to the configured provider model."),
  n: z.literal(1).default(1).describe("Fixed output count for this tool."),
  background: z.enum(["transparent", "opaque", "auto"]).default("auto").describe("Generated image background mode."),
  output_format: z.enum(["png", "jpeg", "webp"]).optional().describe("Output file format. Inferred from filename when omitted."),
  quality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]).default("high").describe("Image quality. Start with high and increase only after inspecting an unsatisfactory result."),
  size: z.string().min(1).optional().describe("Optional image dimensions. Omit to let the provider choose; use a concrete WIDTHxHEIGHT size when the output needs a specific composition."),
  output_compression: z.number().int().min(0).max(100).optional().describe("Optional JPEG or WebP compression from 0 to 100.")
};

const EditImageInputSchema = {
  prompt: z.string().min(1).max(32_000).describe("Text instructions for editing the input image or combining the input images."),
  image_paths: z.array(z.string().min(1)).min(1).describe("One or more source image paths. Relative paths resolve inside the current task directory."),
  filename: z.string().min(1).describe("Output image filename. Relative paths resolve inside the current task directory."),
  model: z.string().min(1).optional().describe("Image model. Defaults to the configured provider model."),
  n: z.literal(1).default(1).describe("Fixed output count for this tool."),
  background: z.enum(["transparent", "opaque", "auto"]).default("auto").describe("Generated image background mode."),
  output_format: z.enum(["png", "jpeg", "webp"]).optional().describe("Output file format. Inferred from filename when omitted."),
  mask_path: z.string().min(1).optional().describe("Optional transparent mask image path. The mask applies to the first source image."),
  quality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]).default("high").describe("Image quality. Start with high and increase only after inspecting an unsatisfactory result."),
  size: z.string().min(1).optional().describe("Optional image dimensions. Omit to let the provider choose; use a concrete WIDTHxHEIGHT size when the output needs a specific composition."),
  output_compression: z.number().int().min(0).max(100).optional().describe("Optional JPEG or WebP compression from 0 to 100."),
  input_fidelity: z.enum(["low", "high"]).optional().describe("Optional edit input-fidelity setting when supported by the selected model.")
};

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

function expandEnvInString(value) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, envName) => {
    const envValue = process.env[envName];
    if (envValue === undefined) {
      throw new Error(`Config references env var ${envName} but it is not set.`);
    }
    return envValue;
  });
}

function expandEnvPlaceholders(value) {
  if (typeof value === "string") {
    return expandEnvInString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandEnvPlaceholders(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandEnvPlaceholders(entry)])
    );
  }
  return value;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function applyEnvOverrides(base) {
  const provider = base.provider ?? {};
  return {
    ...base,
    logLevel: process.env.IMAGE_GENERATION_LOG_LEVEL ?? base.logLevel,
    provider: {
      ...provider,
      ...(process.env.IMAGE_GENERATION_API_KEY ? { apiKey: process.env.IMAGE_GENERATION_API_KEY } : null),
      ...(process.env.IMAGE_GENERATION_API_KEY_ENV ? { apiKeyEnvVar: process.env.IMAGE_GENERATION_API_KEY_ENV } : null),
      ...(process.env.IMAGE_GENERATION_BASE_URL ? { baseURL: process.env.IMAGE_GENERATION_BASE_URL } : null),
      ...(process.env.IMAGE_GENERATION_PROVIDER_NAME ? { name: process.env.IMAGE_GENERATION_PROVIDER_NAME } : null),
      ...(process.env.IMAGE_GENERATION_MAX_RETRIES ? { maxRetries: Number(process.env.IMAGE_GENERATION_MAX_RETRIES) } : null),
      ...(process.env.IMAGE_GENERATION_TIMEOUT_MS ? { timeoutMs: Number(process.env.IMAGE_GENERATION_TIMEOUT_MS) } : null)
    }
  };
}

async function loadConfig() {
  const configPath = process.env.IMAGE_GENERATION_CONFIG_PATH;
  const configJson = process.env.IMAGE_GENERATION_CONFIG_JSON;

  let base = {};
  if (configPath) {
    const raw = await fs.readFile(configPath, "utf-8");
    base = expandEnvPlaceholders(JSON.parse(raw));
  } else if (configJson) {
    base = expandEnvPlaceholders(JSON.parse(configJson));
  } else {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(process.cwd(), "image-generation.config.json"),
      path.resolve(moduleDir, "image-generation.config.json")
    ];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        const raw = await fs.readFile(candidate, "utf-8");
        base = expandEnvPlaceholders(JSON.parse(raw));
        break;
      }
    }
  }

  const parsed = ConfigSchema.parse(applyEnvOverrides(base));
  const apiKey = resolveApiKey(parsed.provider);
  if (!apiKey) {
    const envVar = parsed.provider.apiKeyEnvVar ?? "OPENAI_API_KEY";
    throw new Error(`Missing image generation API key. Set ${envVar} or config.provider.apiKey.`);
  }
  return parsed;
}

function resolveApiKey(provider) {
  if (provider.apiKey) {
    return provider.apiKey;
  }
  return process.env[provider.apiKeyEnvVar ?? "OPENAI_API_KEY"];
}

function buildEndpoint(baseURL, endpointPath) {
  return `${baseURL.replace(/\/+$/, "")}${endpointPath}`;
}

function inferOutputFormat(filename, outputFormat) {
  if (outputFormat) {
    return outputFormat;
  }
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "jpeg";
  }
  if (ext === ".webp") {
    return "webp";
  }
  return "png";
}

function mimeTypeForFormat(format) {
  if (format === "jpeg") {
    return "image/jpeg";
  }
  if (format === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function extensionForFormat(format) {
  if (format === "jpeg") {
    return ".jpg";
  }
  if (format === "webp") {
    return ".webp";
  }
  return ".png";
}

function resolveOutputPath(filename, outputFormat) {
  const taskRoot = path.resolve(resolveTaskPathBaseDir());
  const requestedPath = path.isAbsolute(filename)
    ? path.normalize(filename)
    : path.resolve(taskRoot, filename);
  const format = inferOutputFormat(requestedPath, outputFormat);
  const outputPath = path.extname(requestedPath) ? requestedPath : `${requestedPath}${extensionForFormat(format)}`;
  const relativePath = path.relative(taskRoot, outputPath);
  if (!isWithinPath(taskRoot, outputPath)) {
    throw new Error("filename must resolve inside the current task directory.");
  }
  return {
    outputPath,
    relativePath: relativePath.split(path.sep).join("/"),
    format
  };
}

async function resolveInputImagePath(inputPath, fieldName) {
  const taskRoot = path.resolve(resolveTaskPathBaseDir());
  const requestedPath = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(taskRoot, inputPath);
  if (!isWithinPath(taskRoot, requestedPath)) {
    throw new Error(`${fieldName} must resolve inside the current task directory.`);
  }

  const [realTaskRoot, realInputPath] = await Promise.all([
    fs.realpath(taskRoot),
    fs.realpath(requestedPath)
  ]);
  if (!isWithinPath(realTaskRoot, realInputPath)) {
    throw new Error(`${fieldName} must resolve inside the current task directory.`);
  }

  const stat = await fs.stat(realInputPath);
  if (!stat.isFile()) {
    throw new Error(`${fieldName} must refer to a file.`);
  }
  return realInputPath;
}

function shouldRetry(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 30_000);
    }
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return Math.min(Math.max(timestamp - Date.now(), 0), 30_000);
    }
  }
  return Math.min(500 * 2 ** attempt, 30_000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildProviderHeaders(provider, contentType) {
  const customHeaders = contentType
    ? provider.headers
    : Object.fromEntries(
      Object.entries(provider.headers).filter(([name]) => name.toLowerCase() !== "content-type")
    );
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...customHeaders,
    Authorization: `Bearer ${resolveApiKey(provider)}`
  };
}

async function requestImage(config, endpointPath, body, headers) {
  const provider = config.provider;
  const endpoint = buildEndpoint(provider.baseURL, endpointPath);

  let lastError = null;
  for (let attempt = 0; attempt <= provider.maxRetries; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers,
          body
        },
        provider.timeoutMs
      );
    } catch (error) {
      lastError = error;
      if (attempt >= provider.maxRetries) {
        throw error;
      }
      await sleep(Math.min(500 * 2 ** attempt, 30_000));
      continue;
    }

    if (response.ok) {
      return await response.json();
    }

    const responseText = await response.text();
    lastError = new Error(`Image generation request failed (${response.status}): ${responseText}`);
    if (attempt >= provider.maxRetries || !shouldRetry(response.status)) {
      throw lastError;
    }
    await sleep(retryDelayMs(response, attempt));
  }

  throw lastError ?? new Error("Image generation request failed.");
}

async function requestImageGeneration(config, body) {
  return requestImage(
    config,
    IMAGE_GENERATION_PATH,
    JSON.stringify(body),
    buildProviderHeaders(config.provider, "application/json")
  );
}

async function requestImageEdit(config, formData) {
  return requestImage(
    config,
    IMAGE_EDIT_PATH,
    formData,
    buildProviderHeaders(config.provider)
  );
}

function readImageData(result) {
  const first = result?.data?.[0];
  if (!first || typeof first !== "object") {
    throw new Error("Image generation response did not include data[0].");
  }
  if (typeof first.b64_json === "string" && first.b64_json.length > 0) {
    return {
      kind: "base64",
      value: first.b64_json
    };
  }
  if (typeof first.url === "string" && first.url.length > 0) {
    return {
      kind: "url",
      value: first.url
    };
  }
  throw new Error("Image generation response did not include b64_json or url.");
}

async function imageBytesFromResult(result, timeoutMs) {
  const imageData = readImageData(result);
  if (imageData.kind === "base64") {
    return Buffer.from(imageData.value, "base64");
  }

  const response = await fetchWithTimeout(imageData.value, { method: "GET" }, timeoutMs);
  if (!response.ok) {
    throw new Error(`Failed to download generated image (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function buildImageRequest({ prompt, model, n, background, output_format, quality, size, output_compression }) {
  return {
    model,
    prompt,
    n,
    background,
    output_format,
    moderation: "low",
    quality,
    ...(size ? { size } : null),
    ...(output_compression !== undefined ? { output_compression } : null)
  };
}

function mimeTypeForImagePath(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  return "application/octet-stream";
}

async function imageUploadFromPath(inputPath, fieldName) {
  const sourcePath = await resolveInputImagePath(inputPath, fieldName);
  const bytes = await fs.readFile(sourcePath);
  return {
    sourcePath,
    blob: new Blob([bytes], { type: mimeTypeForImagePath(sourcePath) })
  };
}

function buildImageEditRequest({ prompt, imageUploads, maskUpload, model, n, background, output_format, quality, size, output_compression, input_fidelity }) {
  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  for (const imageUpload of imageUploads) {
    formData.append("image[]", imageUpload.blob, path.basename(imageUpload.sourcePath));
  }
  if (maskUpload) {
    formData.append("mask", maskUpload.blob, path.basename(maskUpload.sourcePath));
  }
  formData.append("n", String(n));
  formData.append("background", background);
  formData.append("output_format", output_format);
  formData.append("moderation", "low");
  formData.append("quality", quality);
  if (size) {
    formData.append("size", size);
  }
  if (output_compression !== undefined) {
    formData.append("output_compression", String(output_compression));
  }
  if (input_fidelity) {
    formData.append("input_fidelity", input_fidelity);
  }
  return formData;
}

const config = await loadConfig();
const server = new McpServer({
  name: "image-generation",
  version: "1.0.0"
});

server.tool(
  "generate_image",
  "Generate one image with the configured OpenAI-compatible image generation endpoint and save it to a file.",
  GenerateImageInputSchema,
  async ({ prompt, filename, model, n, background, output_format, quality, size, output_compression }) => {
    const { outputPath, relativePath, format } = resolveOutputPath(filename, output_format);
    const requestBody = buildImageRequest({
      prompt,
      model: model ?? config.provider.model,
      n,
      background,
      output_format: format,
      quality,
      size,
      output_compression
    });

    const result = await requestImageGeneration(config, requestBody);
    const bytes = await imageBytesFromResult(result, config.provider.timeoutMs);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes);

    const payload = {
      ok: true,
      output_path: outputPath,
      relative_path: relativePath,
      mime_type: mimeTypeForFormat(format),
      size_bytes: bytes.byteLength,
      request: {
        model: requestBody.model,
        n: requestBody.n,
        background: requestBody.background,
        output_format: requestBody.output_format,
        moderation: requestBody.moderation,
        quality: requestBody.quality,
        size: requestBody.size,
        output_compression: requestBody.output_compression
      },
      provider: {
        name: config.provider.name ?? config.provider.provider,
        baseURL: config.provider.baseURL
      },
      inline_artifact: {
        type: "image",
        relative_path: relativePath,
        title: path.basename(outputPath)
      }
    };
    return asToolResult(payload);
  }
);

server.tool(
  "edit_image",
  "Edit one or more task images with the configured OpenAI-compatible image edits endpoint and save the result to a file.",
  EditImageInputSchema,
  async ({ prompt, image_paths, filename, model, n, background, output_format, mask_path, quality, size, output_compression, input_fidelity }) => {
    const { outputPath, relativePath, format } = resolveOutputPath(filename, output_format);
    const imageUploads = await Promise.all(
      image_paths.map((imagePath, index) => imageUploadFromPath(imagePath, `image_paths[${index}]`))
    );
    const maskUpload = mask_path ? await imageUploadFromPath(mask_path, "mask_path") : null;
    const formData = buildImageEditRequest({
      prompt,
      imageUploads,
      maskUpload,
      model: model ?? config.provider.model,
      n,
      background,
      output_format: format,
      quality,
      size,
      output_compression,
      input_fidelity
    });

    const result = await requestImageEdit(config, formData);
    const bytes = await imageBytesFromResult(result, config.provider.timeoutMs);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes);

    const payload = {
      ok: true,
      output_path: outputPath,
      relative_path: relativePath,
      mime_type: mimeTypeForFormat(format),
      size_bytes: bytes.byteLength,
      request: {
        model: model ?? config.provider.model,
        n,
        background,
        output_format: format,
        moderation: "low",
        quality,
        ...(size ? { size } : null),
        ...(output_compression !== undefined ? { output_compression } : null),
        ...(input_fidelity ? { input_fidelity } : null),
        image_count: imageUploads.length,
        has_mask: Boolean(maskUpload)
      },
      provider: {
        name: config.provider.name ?? config.provider.provider,
        baseURL: config.provider.baseURL
      },
      inline_artifact: {
        type: "image",
        relative_path: relativePath,
        title: path.basename(outputPath)
      }
    };
    return asToolResult(payload);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
