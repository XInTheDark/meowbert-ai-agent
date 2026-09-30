import PizZip from "pizzip";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function applyLiteralReplacements(sourceText, replacements) {
  let text = sourceText;
  let replacementCount = 0;

  for (const replacement of replacements) {
    const flags = replacement.ignore_case ? "gi" : "g";
    const regex = new RegExp(
      escapeRegExp(replacement.find),
      replacement.replace_all === false ? flags.replace("g", "") : flags
    );
    const matches = text.match(regex);
    if (!matches?.length) {
      continue;
    }

    replacementCount += matches.length;
    text = text.replace(regex, replacement.replace);
  }

  return {
    text,
    replacementCount
  };
}

function replaceTextInXmlContainers(xml, containerRegex, textNodeRegex, replacements) {
  let replacementCount = 0;
  let changedContainers = 0;

  const updatedXml = xml.replace(containerRegex, (containerXml) => {
    textNodeRegex.lastIndex = 0;
    const nodes = [];
    let match;
    while ((match = textNodeRegex.exec(containerXml)) !== null) {
      nodes.push(match[1]);
    }

    if (nodes.length === 0) {
      return containerXml;
    }

    const currentText = nodes.map((entry) => decodeXmlEntities(entry)).join("");
    const updated = applyLiteralReplacements(currentText, replacements);
    if (updated.replacementCount === 0 || updated.text === currentText) {
      return containerXml;
    }

    changedContainers += 1;
    replacementCount += updated.replacementCount;

    textNodeRegex.lastIndex = 0;
    let nodeIndex = 0;
    return containerXml.replace(textNodeRegex, (fullMatch, innerText) => {
      const nextText = nodeIndex === 0 ? encodeXmlEntities(updated.text) : "";
      nodeIndex += 1;
      return fullMatch.replace(innerText, nextText);
    });
  });

  return {
    xml: updatedXml,
    replacementCount,
    changedContainers
  };
}

function replaceTextInZipParts(buffer, partRegex, containerRegex, textNodeRegex, replacements) {
  const zip = new PizZip(buffer.toString("binary"));
  const changedParts = [];
  let replacementCount = 0;

  for (const fileName of Object.keys(zip.files)) {
    if (!partRegex.test(fileName)) {
      continue;
    }

    const file = zip.file(fileName);
    if (!file) {
      continue;
    }

    const updated = replaceTextInXmlContainers(file.asText(), containerRegex, textNodeRegex, replacements);
    if (updated.replacementCount === 0) {
      continue;
    }

    zip.file(fileName, updated.xml);
    replacementCount += updated.replacementCount;
    changedParts.push({
      file: fileName,
      replacements: updated.replacementCount,
      changed_containers: updated.changedContainers
    });
  }

  return {
    buffer: zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE"
    }),
    replacementCount,
    changedParts
  };
}

function normalizeReplacements(replacements) {
  const normalized = (replacements ?? []).map((replacement) => ({
    find: String(replacement?.find ?? ""),
    replace: String(replacement?.replace ?? ""),
    replace_all: replacement?.replace_all !== false,
    ignore_case: replacement?.ignore_case === true
  }));

  for (const replacement of normalized) {
    if (!replacement.find) {
      throw new Error("Each replacement requires a non-empty `find` string.");
    }
  }

  if (normalized.length === 0) {
    throw new Error("At least one replacement is required.");
  }

  return normalized;
}

export function replaceTextInDocxBuffer(buffer, replacements) {
  return replaceTextInZipParts(
    buffer,
    /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/i,
    /<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi,
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi,
    normalizeReplacements(replacements)
  );
}

export function replaceTextInPptxBuffer(buffer, replacements) {
  return replaceTextInZipParts(
    buffer,
    /^ppt\/(slides|notesSlides)\/.*\.xml$/i,
    /<a:p\b[^>]*>[\s\S]*?<\/a:p>/gi,
    /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi,
    normalizeReplacements(replacements)
  );
}
