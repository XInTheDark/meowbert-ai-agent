import assert from "node:assert/strict";
import test from "node:test";
import { buildPdfConvertArgument, normalizePageRange } from "./office-utils.mjs";

test("normalizePageRange returns null when no range is provided", () => {
  assert.equal(normalizePageRange(undefined, undefined), null);
});

test("normalizePageRange validates and normalizes open-ended ranges", () => {
  assert.deepEqual(normalizePageRange(3, null), {
    startPage: 3,
    endPage: null,
    value: "3-"
  });
  assert.deepEqual(normalizePageRange(null, 4), {
    startPage: 1,
    endPage: 4,
    value: "1-4"
  });
});

test("buildPdfConvertArgument includes LibreOffice JSON filter options when a range is requested", () => {
  assert.equal(
    buildPdfConvertArgument("writer_pdf_Export", 2, 5),
    'pdf:writer_pdf_Export:{"PageRange":{"type":"string","value":"2-5"}}'
  );
  assert.equal(buildPdfConvertArgument("impress_pdf_Export"), "pdf:impress_pdf_Export");
});

test("normalizePageRange rejects invalid ranges", () => {
  assert.throws(() => normalizePageRange(0, 2), /start_page/);
  assert.throws(() => normalizePageRange(5, 4), /end_page/);
});
