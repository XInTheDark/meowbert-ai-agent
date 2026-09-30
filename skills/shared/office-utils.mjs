import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolveTaskScopedUserPath } from "./task-path-utils.mjs";

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function splitPathEntries(value) {
  return String(value ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function isExecutableFile(candidatePath) {
  try {
    await fs.access(candidatePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(candidates) {
  const pathEntries = splitPathEntries(process.env.PATH);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (candidate.includes(path.sep)) {
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
      continue;
    }

    for (const entry of pathEntries) {
      const resolved = path.join(entry, candidate);
      if (await isExecutableFile(resolved)) {
        return resolved;
      }
    }
  }

  return null;
}

export async function findOfficeBinary() {
  return findExecutable([
    process.env.LIBREOFFICE_BIN,
    "soffice",
    "libreoffice",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice"
  ]);
}

export function normalizePageRange(startPage, endPage) {
  const hasStart = startPage !== undefined && startPage !== null;
  const hasEnd = endPage !== undefined && endPage !== null;

  if (!hasStart && !hasEnd) {
    return null;
  }

  if (hasStart && !isPositiveInteger(startPage)) {
    throw new Error("start_page must be a positive integer.");
  }

  if (hasEnd && !isPositiveInteger(endPage)) {
    throw new Error("end_page must be a positive integer.");
  }

  const resolvedStart = hasStart ? startPage : 1;
  const resolvedEnd = hasEnd ? endPage : null;

  if (resolvedEnd !== null && resolvedEnd < resolvedStart) {
    throw new Error("end_page must be greater than or equal to start_page.");
  }

  return {
    startPage: resolvedStart,
    endPage: resolvedEnd,
    value: resolvedEnd === null ? `${resolvedStart}-` : `${resolvedStart}-${resolvedEnd}`
  };
}

export function buildPdfConvertArgument(exportFilter, startPage, endPage) {
  const trimmedFilter = String(exportFilter ?? "").trim();
  if (!trimmedFilter) {
    throw new Error("exportFilter is required.");
  }

  const pageRange = normalizePageRange(startPage, endPage);
  if (!pageRange) {
    return `pdf:${trimmedFilter}`;
  }

  return `pdf:${trimmedFilter}:${JSON.stringify({
    PageRange: {
      type: "string",
      value: pageRange.value
    }
  })}`;
}

function runCommand(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${path.basename(binary)} exited with code ${code}. ${stderr || stdout}`.trim()));
    });
  });
}

export async function convertOfficeDocumentToPdf({ inputPath, outputPath, exportFilter, startPage, endPage }) {
  const officeBinary = await findOfficeBinary();
  if (!officeBinary) {
    throw new Error(
      "LibreOffice was not found. Install `libreoffice`/`soffice` or set the LIBREOFFICE_BIN environment variable."
    );
  }

  const absoluteInputPath = resolveTaskScopedUserPath(inputPath);
  const absoluteOutputPath = resolveTaskScopedUserPath(outputPath);
  const pageRange = normalizePageRange(startPage, endPage);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "office-pdf-"));
  const profileDir = path.join(tempRoot, "profile");
  const convertDir = path.join(tempRoot, "convert");

  try {
    await fs.mkdir(profileDir, { recursive: true });
    await fs.mkdir(convertDir, { recursive: true });

    const convertArgument = buildPdfConvertArgument(exportFilter, startPage, endPage);
    await runCommand(officeBinary, [
      `-env:UserInstallation=${pathToFileURL(profileDir).toString()}`,
      "--headless",
      "--convert-to",
      convertArgument,
      "--outdir",
      convertDir,
      absoluteInputPath
    ]);

    const expectedPdfPath = path.join(convertDir, `${path.parse(absoluteInputPath).name}.pdf`);
    try {
      await fs.access(expectedPdfPath);
    } catch {
      throw new Error(`LibreOffice did not create a PDF at ${expectedPdfPath}.`);
    }

    await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await fs.copyFile(expectedPdfPath, absoluteOutputPath);

    return {
      outputPath: absoluteOutputPath,
      inputPath: absoluteInputPath,
      officeBinary,
      exportFilter,
      pageRange: pageRange?.value ?? null
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
