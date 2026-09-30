import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatByteLimit } from "./view-limits.js";

interface PreparedPdfView {
  outputBuffer: Buffer;
  outputFileName: string;
  effectivePageStart: number;
  effectivePageEnd: number;
  totalPages: number;
  message?: string;
}

interface PythonPreparedPdfViewJson {
  effective_page_end: number;
  effective_page_start: number;
  message?: string;
  total_pages: number;
}

const PYTHON_EXEC_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const PYTHON_PDF_PREPARE_SCRIPT = [
  "import json",
  "import shutil",
  "import sys",
  "from pypdf import PdfReader, PdfWriter",
  "",
  "input_path, output_path, page_start_raw, page_end_raw = sys.argv[1:5]",
  "page_start = int(page_start_raw)",
  "page_end = int(page_end_raw)",
  "reader = PdfReader(input_path)",
  "total_pages = len(reader.pages)",
  "if total_pages < 1:",
  "    raise ValueError('PDF has no pages.')",
  "if page_start > total_pages:",
  "    raise ValueError(f'Requested page range {page_start}-{page_end} is outside the valid range 1-{total_pages}.')",
  "effective_page_end = min(page_end, total_pages)",
  "is_full_range = page_start == 1 and effective_page_end == total_pages",
  "if is_full_range:",
  "    shutil.copyfile(input_path, output_path)",
  "else:",
  "    writer = PdfWriter()",
  "    for page_index in range(page_start - 1, effective_page_end):",
  "        writer.add_page(reader.pages[page_index])",
  "    with open(output_path, 'wb') as output_file:",
  "        writer.write(output_file)",
  "print(json.dumps({",
  "    'effective_page_end': effective_page_end,",
  "    'effective_page_start': page_start,",
  "    'message': None if is_full_range else f'Loaded only pages {page_start}-{effective_page_end}. There are more pages outside this range; valid page range is 1-{total_pages}.',",
  "    'total_pages': total_pages",
  "}))"
].join("\n");

function buildPdfSubsetFileName(fileName: string, pageStart: number, pageEnd: number): string {
  const dotIndex = fileName.lastIndexOf(".");
  const hasExt = dotIndex > 0;
  const basename = hasExt ? fileName.slice(0, dotIndex) : fileName;
  const ext = hasExt ? fileName.slice(dotIndex) : "";
  return `${basename}-pages-${pageStart}-${pageEnd}${ext || ".pdf"}`;
}

async function execFileText(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: PYTHON_EXEC_MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr?.trim() || error.message || String(error);
        reject(new Error(message));
        return;
      }

      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? ""
      });
    });
  });
}

const pdfToolDeps = {
  execFileText
};

export const pdfToolTestUtils = {
  deps: pdfToolDeps
};

export async function preparePdfView(input: {
  fileBuffer: Buffer;
  fileName: string;
  pageStart: number;
  pageEnd: number;
  maxOutputBytes?: number;
}): Promise<PreparedPdfView> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "meowbert-pdf-view-"));
  const inputPath = path.join(tempDir, "input.pdf");
  const outputPath = path.join(tempDir, "output.pdf");

  try {
    await writeFile(inputPath, input.fileBuffer);

    const { stdout } = await pdfToolDeps.execFileText("python3", [
      "-c",
      PYTHON_PDF_PREPARE_SCRIPT,
      inputPath,
      outputPath,
      String(input.pageStart),
      String(input.pageEnd)
    ]);

    const parsed = JSON.parse(stdout) as PythonPreparedPdfViewJson;
    const outputStats = await stat(outputPath);
    if (typeof input.maxOutputBytes === "number" && outputStats.size > input.maxOutputBytes) {
      throw new Error(`Prepared PDF exceeds the ${formatByteLimit(input.maxOutputBytes)} viewer limit.`);
    }
    const outputBuffer = await readFile(outputPath);
    const isFullRange = parsed.effective_page_start === 1 && parsed.effective_page_end === parsed.total_pages;

    return {
      outputBuffer,
      outputFileName: isFullRange
        ? input.fileName
        : buildPdfSubsetFileName(input.fileName, parsed.effective_page_start, parsed.effective_page_end),
      effectivePageStart: parsed.effective_page_start,
      effectivePageEnd: parsed.effective_page_end,
      totalPages: parsed.total_pages,
      ...(parsed.message ? { message: parsed.message } : {})
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read PDF with bundled pypdf: ${message}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
