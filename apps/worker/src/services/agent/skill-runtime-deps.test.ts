import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function normalizePackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
}

describe("skill runtime dependencies", () => {
  it("keeps npm imports used by bundled skills declared in the worker runtime", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
    const workerPackageJsonPath = path.join(repoRoot, "apps/worker/package.json");
    const sandboxPackageJsonPath = path.join(repoRoot, "apps/sandbox-runtime/package.json");
    const skillsRoot = path.join(repoRoot, "skills");
    const workerPackageJson = JSON.parse(fs.readFileSync(workerPackageJsonPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const sandboxPackageJson = JSON.parse(fs.readFileSync(sandboxPackageJsonPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const runtimeDeps = new Set([
      ...Object.keys(workerPackageJson.dependencies ?? {}),
      ...Object.keys(workerPackageJson.devDependencies ?? {}),
      ...Object.keys(sandboxPackageJson.dependencies ?? {}),
      ...Object.keys(sandboxPackageJson.devDependencies ?? {})
    ]);
    const importPattern = /from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
    const missingByPackage = new Map<string, Set<string>>();

    for (const skillEntry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!skillEntry.isDirectory()) {
        continue;
      }

      const skillDir = path.join(skillsRoot, skillEntry.name);
      for (const fileName of fs.readdirSync(skillDir)) {
        if (!fileName.endsWith(".mjs")) {
          continue;
        }

        const filePath = path.join(skillDir, fileName);
        const source = fs.readFileSync(filePath, "utf-8");
        for (const match of source.matchAll(importPattern)) {
          const specifier = match[1] ?? match[2];
          if (!specifier || specifier.startsWith(".") || specifier.startsWith("node:")) {
            continue;
          }

          const packageName = normalizePackageName(specifier);
          if (runtimeDeps.has(packageName) || (packageName === "playwright-core" && runtimeDeps.has("playwright"))) {
            continue;
          }

          const current = missingByPackage.get(packageName) ?? new Set<string>();
          current.add(path.relative(repoRoot, filePath));
          missingByPackage.set(packageName, current);
        }
      }
    }

    expect(
      Array.from(missingByPackage.entries()).map(([packageName, filePaths]) => ({
        packageName,
        files: Array.from(filePaths).sort()
      }))
    ).toEqual([]);
  });
});
