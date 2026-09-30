import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const docsRoot = path.resolve(__dirname, "../docs");
const outputPath = path.resolve(__dirname, "../../web/src/onboarding/generatedDocsManifest.ts");

const REQUIRED_ONBOARDING_IDS = [
  "welcome",
  "workspace-navigation",
  "create-project",
  "project-master",
  "project-overview",
  "task-composer",
  "task-follow-up",
  "files-browser",
  "workspace-memory",
  "scheduled-tasks",
  "connectors",
  "notifications",
  "task-workflows",
  "interactive-canvas",
  "agent-shells",
  "wrap-up"
];

async function listMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listMarkdownFiles(fullPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseFrontmatter(markdown) {
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatterMatch) {
    return null;
  }

  const fields = {};
  const lines = frontmatterMatch[1].split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    fields[key] = value;
  }

  return fields;
}

function toDocsPath(filePath) {
  const relative = path.relative(docsRoot, filePath).replace(/\\/g, "/");
  const withoutExt = relative.replace(/\.md$/, "");
  if (withoutExt === "index") {
    return "/";
  }

  if (withoutExt.endsWith("/index")) {
    return `/${withoutExt.slice(0, -"/index".length)}`;
  }

  return `/${withoutExt}`;
}

function assertRequiredField(fields, fieldName, filePath) {
  const value = fields[fieldName];
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required frontmatter field \"${fieldName}\" in ${filePath}`);
  }

  return value;
}

async function main() {
  const files = await listMarkdownFiles(docsRoot);
  const manifest = new Map();

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter || !frontmatter.onboardingId) {
      continue;
    }

    const onboardingId = assertRequiredField(frontmatter, "onboardingId", file);
    const title = assertRequiredField(frontmatter, "title", file);
    const summary = assertRequiredField(frontmatter, "summary", file);
    const checklistLabel =
      typeof frontmatter.checklistLabel === "string" && frontmatter.checklistLabel.trim().length > 0
        ? frontmatter.checklistLabel.trim()
        : title;

    if (manifest.has(onboardingId)) {
      throw new Error(`Duplicate onboardingId \"${onboardingId}\" found in ${file}`);
    }

    manifest.set(onboardingId, {
      id: onboardingId,
      title,
      summary,
      checklistLabel,
      docsPath: toDocsPath(file)
    });
  }

  for (const id of REQUIRED_ONBOARDING_IDS) {
    if (!manifest.has(id)) {
      throw new Error(`Missing onboarding docs entry for required id \"${id}\"`);
    }
  }

  const sortedEntries = [...manifest.entries()].sort(([a], [b]) => a.localeCompare(b));

  const lines = [];
  lines.push("export interface OnboardingDocsEntry {");
  lines.push("  id: string;");
  lines.push("  title: string;");
  lines.push("  summary: string;");
  lines.push("  checklistLabel: string;");
  lines.push("  docsPath: string;");
  lines.push("}");
  lines.push("");
  lines.push("// This file is generated from docs frontmatter.");
  lines.push("// Run `npm run docs:generate-onboarding-manifest` to refresh.");
  lines.push("export const onboardingDocsManifest: Record<string, OnboardingDocsEntry> = {");

  for (const [, entry] of sortedEntries) {
    lines.push(`  ${JSON.stringify(entry.id)}: {`);
    lines.push(`    id: ${JSON.stringify(entry.id)},`);
    lines.push(`    title: ${JSON.stringify(entry.title)},`);
    lines.push(`    summary: ${JSON.stringify(entry.summary)},`);
    lines.push(`    checklistLabel: ${JSON.stringify(entry.checklistLabel)},`);
    lines.push(`    docsPath: ${JSON.stringify(entry.docsPath)}`);
    lines.push("  },");
  }

  lines.push("};");
  lines.push("");

  await fs.writeFile(outputPath, lines.join("\n"), "utf8");
  console.log(`Wrote onboarding manifest to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
