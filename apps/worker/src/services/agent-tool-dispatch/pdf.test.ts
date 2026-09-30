import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfToolTestUtils, preparePdfView } from "./pdf.js";

async function createPdfBuffer(pageCount: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([200, 200]);
  }
  return Buffer.from(await pdf.save());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preparePdfView", () => {
  it("returns a subset filename and metadata for page windows", async () => {
    const subsetBuffer = await createPdfBuffer(1);
    const execFileSpy = vi.spyOn(pdfToolTestUtils.deps, "execFileText").mockImplementation(async (_command, args) => {
      const outputPath = String(args[3]);
      fs.writeFileSync(outputPath, subsetBuffer);
      return {
        stdout: JSON.stringify({
          effective_page_end: 4,
          effective_page_start: 4,
          message: "Loaded only pages 4-4. There are more pages outside this range; valid page range is 1-12.",
          total_pages: 12
        }),
        stderr: ""
      };
    });

    const result = await preparePdfView({
      fileBuffer: Buffer.from("ignored"),
      fileName: "example.pdf",
      pageStart: 4,
      pageEnd: 4
    });

    expect(execFileSpy).toHaveBeenCalledOnce();
    expect(result.outputFileName).toBe("example-pages-4-4.pdf");
    expect(result.effectivePageStart).toBe(4);
    expect(result.effectivePageEnd).toBe(4);
    expect(result.totalPages).toBe(12);
    expect(result.message).toContain("valid page range is 1-12");
    const parsedResultPdf = await PDFDocument.load(result.outputBuffer);
    expect(parsedResultPdf.getPageCount()).toBe(1);
  });

  it("keeps the original filename when the full document is requested", async () => {
    const fullBuffer = await createPdfBuffer(3);
    vi.spyOn(pdfToolTestUtils.deps, "execFileText").mockImplementation(async (_command, args) => {
      const outputPath = String(args[3]);
      fs.writeFileSync(outputPath, fullBuffer);
      return {
        stdout: JSON.stringify({
          effective_page_end: 3,
          effective_page_start: 1,
          total_pages: 3
        }),
        stderr: ""
      };
    });

    const result = await preparePdfView({
      fileBuffer: Buffer.from("ignored"),
      fileName: "normal.pdf",
      pageStart: 1,
      pageEnd: 50
    });

    expect(result.outputFileName).toBe("normal.pdf");
    expect(result.effectivePageStart).toBe(1);
    expect(result.effectivePageEnd).toBe(3);
    expect(result.totalPages).toBe(3);
    expect(result.message).toBeUndefined();
    const parsedResultPdf = await PDFDocument.load(result.outputBuffer);
    expect(parsedResultPdf.getPageCount()).toBe(3);
  });

  it("rejects prepared PDFs whose output still exceeds the viewer limit", async () => {
    const oversizedBuffer = Buffer.alloc(1024 * 1024, 0);
    vi.spyOn(pdfToolTestUtils.deps, "execFileText").mockImplementation(async (_command, args) => {
      const outputPath = String(args[3]);
      fs.writeFileSync(outputPath, oversizedBuffer);
      return {
        stdout: JSON.stringify({
          effective_page_end: 1,
          effective_page_start: 1,
          total_pages: 1
        }),
        stderr: ""
      };
    });

    await expect(
      preparePdfView({
        fileBuffer: Buffer.from("ignored"),
        fileName: "huge.pdf",
        pageStart: 1,
        pageEnd: 1,
        maxOutputBytes: 512 * 1024
      })
    ).rejects.toThrow("viewer limit");
  });
});
