import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSkillEnabledByConfig, type SkillManifest } from "@meowbert/shared";
import type { DockerSandboxHandle, SandboxAttachedProcess } from "@meowbert/shared/docker-sandbox";
import {
  buildSandboxStdioEnv,
  callMcpTool,
  listMcpTools,
  parseSkillToolName,
  providerSafeSkillToolId,
  resolveSkillStdioEnv,
  skillToolName,
  startMcpServer,
  stopMcpServer
} from "./mcp-client.js";
import { getAvailableSkills } from "./skill-registry.js";

function createLocalProcessSandbox(): DockerSandboxHandle {
  return {
    startAttachedProcess: async (input: {
      command: string[];
      workingDir: string;
      env?: Record<string, string>;
    }) => {
      const child = spawn(input.command[0], input.command.slice(1), {
        cwd: input.workingDir,
        env: {
          ...process.env,
          ...(input.env ?? {})
        },
        stdio: ["pipe", "pipe", "pipe"]
      });

      const waitForExit = new Promise<number | null>((resolve) => {
        child.once("exit", (code) => resolve(code));
      });

      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        close: async () => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGTERM");
          }
          await waitForExit;
        },
        waitForExit: async () => waitForExit
      } as SandboxAttachedProcess;
    }
  } as unknown as DockerSandboxHandle;
}

function getRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
}

async function readSkillManifest(skillId: string): Promise<{ manifest: SkillManifest; skillDir: string }> {
  const repoRoot = getRepoRoot();
  const skillDir = path.join(repoRoot, "skills", skillId);
  const manifest = JSON.parse(await fs.readFile(path.join(skillDir, "skill.json"), "utf8")) as SkillManifest;
  return { manifest, skillDir };
}

describe("buildSandboxStdioEnv", () => {
  it("provides writable temp and cache defaults for sandboxed stdio skills", () => {
    expect(buildSandboxStdioEnv()).toEqual({
      HOME: "/tmp",
      TMPDIR: "/tmp",
      XDG_CACHE_HOME: "/tmp/.cache",
      npm_config_cache: "/tmp/.npm"
    });
  });

  it("preserves explicit skill env overrides", () => {
    expect(buildSandboxStdioEnv({
      HOME: "/workspace",
      CUSTOM_FLAG: "1",
      npm_config_cache: "/workspace/.npm"
    })).toEqual({
      HOME: "/workspace",
      TMPDIR: "/tmp",
      XDG_CACHE_HOME: "/tmp/.cache",
      npm_config_cache: "/workspace/.npm",
      CUSTOM_FLAG: "1"
    });
  });

  it("includes stderr diagnostics when a stdio MCP server crashes during startup", async () => {
    const sandbox = createLocalProcessSandbox();
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-broken-skill-"));
    const manifest: SkillManifest = {
      id: "broken-skill",
      name: "Broken Skill",
      description: "Fails during startup",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["-e", "console.error('deep-ai-search startup boom'); process.exit(17);"],
        cwd: "{{SKILL_DIR}}"
      }
    };

    try {
      let message = "";
      try {
        await startMcpServer(manifest, skillDir, sandbox);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain("deep-ai-search startup boom");
      expect(message).toContain("MCP process exit code: 17");
    } finally {
      await fs.rm(skillDir, { recursive: true, force: true });
    }
  });

  it("resolves skill placeholders for worker env variables and skill dir", () => {
    process.env.TEST_SKILL_SECRET = "super-secret";
    expect(resolveSkillStdioEnv({
      CONFIG_PATH: "{{SKILL_DIR}}/deep-ai-search.config.json",
      API_KEY: "{{ENV:TEST_SKILL_SECRET}}"
    }, "/tmp/skill")).toEqual({
      CONFIG_PATH: "/tmp/skill/deep-ai-search.config.json",
      API_KEY: "super-secret"
    });
    delete process.env.TEST_SKILL_SECRET;
  });

  it("allows optional worker env placeholders with defaults", () => {
    delete process.env.TEST_SKILL_OPTIONAL_SECRET;
    delete process.env.TEST_SKILL_OPTIONAL_BASE_URL;
    expect(resolveSkillStdioEnv({
      OPTIONAL_API_KEY: "{{ENV:TEST_SKILL_OPTIONAL_SECRET:-}}",
      OPTIONAL_BASE_URL: "{{ENV:TEST_SKILL_OPTIONAL_BASE_URL:-https://api.openai.com/v1}}"
    }, "/tmp/skill")).toEqual({
      OPTIONAL_API_KEY: "",
      OPTIONAL_BASE_URL: "https://api.openai.com/v1"
    });
  });

  it("throws a helpful error when a required worker env variable is missing", () => {
    delete process.env.TEST_SKILL_MISSING;
    expect(() => resolveSkillStdioEnv({
      API_KEY: "{{ENV:TEST_SKILL_MISSING}}"
    }, "/tmp/skill")).toThrow("Skill requires environment variable TEST_SKILL_MISSING");
  });
});

describe("skill tool names", () => {
  it("uses provider-safe prefixes for skill ids with punctuation", () => {
    expect(providerSafeSkillToolId("html-canvas")).toBe("html_canvas");
    expect(providerSafeSkillToolId("123-slides")).toBe("_123_slides");
    expect(skillToolName("html-canvas", "html_canvas_render")).toBe("html_canvas__html_canvas_render");
    expect(parseSkillToolName("html_canvas__html_canvas_render")).toEqual({
      skillId: "html_canvas",
      toolName: "html_canvas_render"
    });
  });
});

describe("callMcpTool", () => {
  it("returns plain text when an MCP tool responds with text content", async () => {
    const connection = {
      client: {
        callTool: async () => ({
          content: [
            { type: "text", text: "first line" },
            { type: "text", text: "second line" }
          ]
        })
      },
      requestTimeoutMs: 5_000
    } as unknown as Parameters<typeof callMcpTool>[0];

    await expect(callMcpTool(connection, "demo_tool", {})).resolves.toBe("first line\nsecond line");
  });

  it("falls back to structured payloads when an MCP tool returns object data without text content", async () => {
    const connection = {
      client: {
        callTool: async () => ({
          content: [],
          items: [{ id: "123", name: "Quarterly Plan" }],
          folder: { id: null, name: "OneDrive" }
        })
      },
      requestTimeoutMs: 5_000
    } as unknown as Parameters<typeof callMcpTool>[0];

    await expect(callMcpTool(connection, "demo_tool", {})).resolves.toBe(JSON.stringify({
      items: [{ id: "123", name: "Quarterly Plan" }],
      folder: { id: null, name: "OneDrive" }
    }));
  });
});

describe("skill MCP servers", () => {
  it("discovers and activates Typst without admin access or Office enabled", async () => {
    const { manifest, skillDir } = await readSkillManifest("typst");
    const available = getAvailableSkills(path.dirname(skillDir), false, {
      isSkillEnabled: (skill) => isSkillEnabledByConfig({ skills: { office: { enabled: false } } }, skill.id)
    });
    expect(available.some((skill) => skill.id === manifest.id)).toBe(true);
    const connection = await startMcpServer(manifest, skillDir, createLocalProcessSandbox());

    try {
      const tools = await listMcpTools(connection);
      expect(tools).toEqual([]);
    } finally {
      await stopMcpServer(connection);
    }
  });

  it("loads Guided Learning as an instruction-first skill", async () => {
    const { manifest, skillDir } = await readSkillManifest("guided-learning");
    const sandbox = createLocalProcessSandbox();
    const connection = await startMcpServer(manifest, skillDir, sandbox);

    try {
      expect(manifest.name).toBe("Guided Learning");
      expect(await fs.readFile(path.join(skillDir, "skill.md"), "utf8")).toContain("Teach one connected idea at a time");
      expect(await listMcpTools(connection)).toEqual([]);
    } finally {
      await stopMcpServer(connection);
    }
  });



  it("resolves HTML canvas inline artifact paths from the task directory runtime env", async () => {
    const { manifest, skillDir } = await readSkillManifest("html-canvas");
    const sandbox = createLocalProcessSandbox();
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-html-canvas-task-"));
    const connection = await startMcpServer(manifest, skillDir, sandbox, 60_000, {
      TASK_DIR: taskDir,
      MEOWBERT_TASK_DIR: taskDir,
      WORKSPACE_ROOT: taskDir,
      MEOWBERT_WORKSPACE_ROOT: taskDir
    });

    try {
      const output = JSON.parse(await callMcpTool(connection, "html_canvas_inline_artifact", {
        html: "<!doctype html><html><body><h1>Inline test</h1></body></html>",
        output_path: "inline-test.html",
        title: "Inline test",
        width: 760,
        height: 480
      })) as {
        ok: boolean;
        output_path: string;
        inline_artifact: {
          relative_path: string;
          width?: number;
          height?: number;
        };
      };

      expect(output.ok).toBe(true);
      expect(output.output_path).toBe(path.join(taskDir, "inline-test.html"));
      expect(output.inline_artifact.relative_path).toBe("inline-test.html");
      expect(output.inline_artifact.width).toBe(760);
      expect(output.inline_artifact.height).toBe(480);
      await expect(fs.readFile(output.output_path, "utf8")).resolves.toContain("Inline test");
    } finally {
      await stopMcpServer(connection);
      await fs.rm(taskDir, { recursive: true, force: true });
    }
  });

  it("lists DOCX Studio tools from the real skill server", async () => {
    const { manifest, skillDir } = await readSkillManifest("docx-studio");
    const sandbox = createLocalProcessSandbox();
    const connection = await startMcpServer(manifest, skillDir, sandbox);

    try {
      const tools = await listMcpTools(connection);
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "docx_create_styled_document",
        "docx_draw_figure_svg"
      ]));
    } finally {
      await stopMcpServer(connection);
    }
  });

  it("exposes callable PPTX studio tools from the real skill server", async () => {
    const { manifest, skillDir } = await readSkillManifest("pptx-studio");
    const sandbox = createLocalProcessSandbox();
    const connection = await startMcpServer(manifest, skillDir, sandbox);

    try {
      const tools = await listMcpTools(connection);
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "pptx_create_styled_deck",
        "pptx_draw_slide_svg",
        "pptx_fill_template"
      ]));

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-pptx-skill-"));
      const outputPath = path.join(tempDir, "visual.svg");
      try {
        const output = JSON.parse(await callMcpTool(connection, "pptx_draw_slide_svg", {
          output_path: outputPath,
          kind: "roadmap",
          title: "Roadmap",
          items: ["Discovery", "Launch"]
        })) as {
          ok: boolean;
          output_path: string;
        };

        expect(output.ok).toBe(true);
        expect(output.output_path).toBe(outputPath);
        const svgContent = await fs.readFile(outputPath, "utf8");
        expect(svgContent).toContain("<svg");
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } finally {
      await stopMcpServer(connection);
    }
  });

  it("resolves relative skill output paths from the task directory runtime env", async () => {
    const { manifest, skillDir } = await readSkillManifest("pptx-studio");
    const sandbox = createLocalProcessSandbox();
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-skill-task-"));
    const connection = await startMcpServer(manifest, skillDir, sandbox, 60_000, {
      TASK_DIR: taskDir,
      MEOWBERT_TASK_DIR: taskDir,
      WORKSPACE_ROOT: taskDir,
      MEOWBERT_WORKSPACE_ROOT: taskDir
    });

    try {
      const output = JSON.parse(await callMcpTool(connection, "pptx_draw_slide_svg", {
        output_path: "visual.svg",
        kind: "roadmap",
        title: "Roadmap",
        items: ["Discovery", "Launch"]
      })) as {
        ok: boolean;
        output_path: string;
      };

      expect(output.ok).toBe(true);
      expect(output.output_path).toBe(path.join(taskDir, "visual.svg"));
      await expect(fs.readFile(output.output_path, "utf8")).resolves.toContain("<svg");
    } finally {
      await stopMcpServer(connection);
      await fs.rm(taskDir, { recursive: true, force: true });
    }
  });

  it("uploads task image paths to the image edits endpoint", async () => {
    let resolveRequest: (request: {
      method?: string;
      url?: string;
      authorization?: string;
      contentType?: string;
      body: string;
    }) => void = () => {};
    const requestReceived = new Promise<{
      method?: string;
      url?: string;
      authorization?: string;
      contentType?: string;
      body: string;
    }>((resolve) => {
      resolveRequest = resolve;
    });
    const apiServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        resolveRequest({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          contentType: request.headers["content-type"],
          body: Buffer.concat(chunks).toString("utf8")
        });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          data: [{ b64_json: Buffer.from("edited image bytes").toString("base64") }]
        }));
      });
    });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));

    const address = apiServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Image edit test server did not expose a TCP port.");
    }

    const { manifest, skillDir } = await readSkillManifest("image-generation");
    const sandbox = createLocalProcessSandbox();
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-image-edit-task-"));
    const configPath = path.join(taskDir, "image-generation.config.json");
    let connection: Awaited<ReturnType<typeof startMcpServer>> | null = null;

    try {
      await fs.writeFile(path.join(taskDir, "source.png"), "first source image");
      await fs.writeFile(path.join(taskDir, "reference.webp"), "second source image");
      await fs.writeFile(path.join(taskDir, "mask.png"), "transparent mask image");
      await fs.writeFile(configPath, JSON.stringify({
        provider: {
          apiKey: "test-key",
          model: "cliproxy-image-model",
          baseURL: `http://127.0.0.1:${address.port}/v1`,
          maxRetries: 0,
          timeoutMs: 5_000
        }
      }));

      connection = await startMcpServer(manifest, skillDir, sandbox, 60_000, {
        TASK_DIR: taskDir,
        MEOWBERT_TASK_DIR: taskDir,
        WORKSPACE_ROOT: taskDir,
        MEOWBERT_WORKSPACE_ROOT: taskDir,
        IMAGE_GENERATION_CONFIG_PATH: configPath
      });
      const result = JSON.parse(await callMcpTool(connection, "edit_image", {
        prompt: "Combine both products on a white studio background.",
        image_paths: ["source.png", "reference.webp"],
        mask_path: "mask.png",
        quality: "max",
        size: "1536x864",
        output_compression: 85,
        input_fidelity: "high",
        filename: "output/edited.png"
      })) as {
        ok: boolean;
        output_path: string;
        relative_path: string;
        request: { image_count: number; has_mask: boolean };
      };

      expect(result.ok).toBe(true);
      expect(result.output_path).toBe(path.join(taskDir, "output/edited.png"));
      expect(result.relative_path).toBe("output/edited.png");
      expect(result.request).toMatchObject({ image_count: 2, has_mask: true });
      await expect(fs.readFile(result.output_path, "utf8")).resolves.toBe("edited image bytes");

      const imageEditRequest = await requestReceived;
      expect(imageEditRequest).toMatchObject({
        method: "POST",
        url: "/v1/images/edits",
        authorization: "Bearer test-key"
      });
      expect(imageEditRequest.contentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(imageEditRequest.body).toContain('name="image[]"; filename="source.png"');
      expect(imageEditRequest.body).toContain("Content-Type: image/png");
      expect(imageEditRequest.body).toContain('name="image[]"; filename="reference.webp"');
      expect(imageEditRequest.body).toContain('name="mask"; filename="mask.png"');
      expect(imageEditRequest.body).toContain('name="prompt"');
      expect(imageEditRequest.body).toContain("Combine both products on a white studio background.");
      expect(imageEditRequest.body).toContain('name="output_format"');
      expect(imageEditRequest.body).toContain('name="model"');
      expect(imageEditRequest.body).toContain("cliproxy-image-model");
      expect(imageEditRequest.body).toContain('name="quality"');
      expect(imageEditRequest.body).toContain("max");
      expect(imageEditRequest.body).toContain('name="size"');
      expect(imageEditRequest.body).toContain("1536x864");
      expect(imageEditRequest.body).toContain('name="output_compression"');
      expect(imageEditRequest.body).toContain("85");
      expect(imageEditRequest.body).toContain('name="input_fidelity"');
      expect(imageEditRequest.body).toContain("high");
      expect(imageEditRequest.body).toContain("first source image");
      expect(imageEditRequest.body).toContain("second source image");
    } finally {
      if (connection) {
        await stopMcpServer(connection);
      }
      await new Promise<void>((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()));
      await fs.rm(taskDir, { recursive: true, force: true });
    }
  });

  it("creates a PPTX deck when slides include metrics and an external SVG visual", async () => {
    const { manifest, skillDir } = await readSkillManifest("pptx-studio");
    const sandbox = createLocalProcessSandbox();
    const connection = await startMcpServer(manifest, skillDir, sandbox);

    try {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-pptx-deck-"));
      const svgPath = path.join(tempDir, "process.svg");
      const deckPath = path.join(tempDir, "deck.pptx");

      try {
        const svgResult = JSON.parse(await callMcpTool(connection, "pptx_draw_slide_svg", {
          output_path: svgPath,
          kind: "process",
          title: "Delivery Flow",
          items: ["Draft", "Review", "Ship"]
        })) as { ok: boolean };
        expect(svgResult.ok).toBe(true);

        const deckResult = JSON.parse(await callMcpTool(connection, "pptx_create_styled_deck", {
          output_path: deckPath,
          title: "Sample Deck",
          include_title_slide: true,
          slides: [
            {
              title: "Overview",
              body: "Metrics and visuals should coexist.",
              metrics: [
                { label: "Slides", value: "2" },
                { label: "Visuals", value: "1" }
              ]
            },
            {
              title: "Workflow",
              body: "External SVG visual",
              visual_svg_path: svgPath,
              visual_side: "right"
            }
          ]
        })) as {
          ok: boolean;
          output_path: string;
        };

        expect(deckResult.ok).toBe(true);
        expect(deckResult.output_path).toBe(deckPath);
        const deckStat = await fs.stat(deckPath);
        expect(deckStat.size).toBeGreaterThan(0);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } finally {
      await stopMcpServer(connection);
    }
  });
});
