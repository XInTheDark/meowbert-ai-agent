import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";
import { replaceTextInDocxBuffer, replaceTextInPptxBuffer } from "./ooxml-edit-utils.mjs";

function buildZipBuffer(entries) {
  const zip = new PizZip();
  for (const [fileName, content] of Object.entries(entries)) {
    zip.file(fileName, content);
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

test("replaceTextInDocxBuffer rewrites split runs in a paragraph", () => {
  const source = buildZipBuffer({
    "word/document.xml":
      '<w:document><w:body><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p></w:body></w:document>'
  });

  const edited = replaceTextInDocxBuffer(source, [{ find: "Hello world", replace: "Hi team" }]);
  const zip = new PizZip(edited.buffer.toString("binary"));
  const xml = zip.file("word/document.xml").asText();

  assert.equal(edited.replacementCount, 1);
  assert.match(xml, /<w:t>Hi team<\/w:t>/);
});

test("replaceTextInPptxBuffer supports case-insensitive replacements", () => {
  const source = buildZipBuffer({
    "ppt/slides/slide1.xml":
      '<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>Quarterly</a:t></a:r><a:r><a:t> update</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>'
  });

  const edited = replaceTextInPptxBuffer(source, [
    { find: "quarterly update", replace: "Board review", ignore_case: true }
  ]);
  const zip = new PizZip(edited.buffer.toString("binary"));
  const xml = zip.file("ppt/slides/slide1.xml").asText();

  assert.equal(edited.replacementCount, 1);
  assert.match(xml, /<a:t>Board review<\/a:t>/);
});
