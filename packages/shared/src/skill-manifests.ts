import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  SkillCatalogGroup,
  SkillManifest,
  SkillManifestMcp,
  SkillManifestMcpSse,
  SkillManifestMcpStdio
} from "./types.js";

const mcpStdioSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional()
});

const mcpSseSchema = z.object({
  transport: z.literal("sse"),
  url: z.string().url()
});

const sourceMetadataSchema = z.object({
  provider: z.string().min(1),
  supportsAttachments: z.boolean().optional(),
  attachmentMode: z.enum(["file", "note"]).optional(),
  requiresAdminCredentials: z.boolean().optional(),
  requiresWorkspaceConnection: z.boolean().optional()
});

const skillCatalogGroupSchema = z.enum(["core", "visuals", "documents", "web", "custom", "skill"]);
const sourceAccessSchema = z.object({
  sourceId: z.string().min(1)
});

const rawSkillManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  requiresSuperAdmin: z.boolean().optional(),
  hidden: z.boolean().optional(),
  surface: z.enum(["skill", "source", "internal"]).optional(),
  catalogGroup: skillCatalogGroupSchema.optional(),
  source: sourceMetadataSchema.optional(),
  sourceAccess: sourceAccessSchema.optional(),
  mcp: z.discriminatedUnion("transport", [mcpStdioSchema, mcpSseSchema])
}).superRefine((value, ctx) => {
  if (value.surface === "source" && !value.source) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source"],
      message: "Source manifests must define source metadata."
    });
  }
});

export interface SkillManifestEntry {
  manifest: SkillManifest;
  skillDir: string;
}

export function parseSkillManifest(raw: unknown): SkillManifest {
  const parsed = rawSkillManifestSchema.parse(raw);
  return {
    id: parsed.id,
    name: parsed.name,
    description: parsed.description,
    requiresSuperAdmin: parsed.requiresSuperAdmin,
    hidden: parsed.hidden,
    surface: parsed.surface ?? "skill",
    catalogGroup: parsed.catalogGroup ?? "custom",
    source: parsed.source,
    sourceAccess: parsed.sourceAccess,
    mcp: parsed.mcp as SkillManifestMcp
  } satisfies SkillManifest;
}

export function isSourceManifest(manifest: SkillManifest): boolean {
  return manifest.surface === "source";
}

export function isVisibleSkillManifest(manifest: SkillManifest): boolean {
  return !isSourceManifest(manifest) && manifest.hidden !== true && manifest.surface !== "internal";
}

export function getSkillCatalogGroup(manifest: SkillManifest): SkillCatalogGroup {
  return manifest.catalogGroup ?? "custom";
}

export function asSkillManifestStdio(manifest: SkillManifest): SkillManifestMcpStdio | null {
  return manifest.mcp.transport === "stdio" ? manifest.mcp as SkillManifestMcpStdio : null;
}

export function asSkillManifestSse(manifest: SkillManifest): SkillManifestMcpSse | null {
  return manifest.mcp.transport === "sse" ? manifest.mcp as SkillManifestMcpSse : null;
}

export function loadSkillManifestEntries(rootDir: string): Map<string, SkillManifestEntry> {
  const manifests = new Map<string, SkillManifestEntry>();

  if (!fs.existsSync(rootDir)) {
    return manifests;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDir = path.join(rootDir, entry.name);
    const manifestPath = path.join(skillDir, "skill.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const manifest = parseSkillManifest(raw);
      manifests.set(manifest.id, { manifest, skillDir });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping invalid skill manifest at ${skillDir}: ${message}`);
    }
  }

  return manifests;
}
