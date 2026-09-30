import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("office preview sandbox runtime bundle", () => {
  it("installs LibreOffice only when the office bundle is enabled", () => {
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const dockerfilePath = path.join(repoRoot, "apps/sandbox-runtime/Dockerfile");
    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");

    expect(dockerfile).toMatch(/resolve-office-build\.mjs/);
    expect(dockerfile).toMatch(/office-build\.json/);
    expect(dockerfile).toMatch(/apt-get install -y --no-install-recommends libreoffice/);
    expect(dockerfile).toMatch(/\[office-build\] skipping LibreOffice install/);
    expect(dockerfile).not.toMatch(/\n\s+libreoffice\s+\\/);
    expect(dockerfile).toMatch(/markitdown\[all\]/);
    expect(dockerfile).toMatch(/\bpypdf\b/);
    expect(dockerfile).toMatch(/\breportlab\b/);
    expect(dockerfile).toMatch(/\bpython-docx\b/);
    expect(dockerfile).toMatch(/\bpython-pptx\b/);
  });

  it("installs pypdf in the worker image for PDF page subsetting", () => {
    const repoRoot = path.resolve(__dirname, "../../../../..");
    const dockerfilePath = path.join(repoRoot, "apps/worker/Dockerfile");
    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");

    expect(dockerfile).toMatch(/\bpypdf\b/);
  });
});
