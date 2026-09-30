import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isBrowserUseEnabled, isHtmlCanvasEnabled, isOfficeEnabled, isSkillEnabledByConfig, loadConfig } from "./config.js";

const baseConfig = {
  server: {
    host: "0.0.0.0",
    port: 4000,
    publicUrl: "http://localhost:4000"
  },
  db: {
    url: "postgres://postgres:postgres@127.0.0.1:5432/meowbert"
  },
  redis: {
    url: "redis://127.0.0.1:6379"
  },
  openai: {
    defaultModel: "o4-mini"
  },
  runtime: {
    shell: "/bin/bash",
    workspacesRoot: "./runtime/workspaces",
    environmentsRoot: "./runtime/environments",
    tasksRoot: "./runtime/tasks",
    commandTimeoutMs: 900000,
    maxCommandOutputKb: 256,
    maxSteps: 16,
    workerConcurrency: 4,
    sandbox: {
      provider: "docker",
      image: "meowbert-sandbox-runtime:local",
      dockerHost: "unix:///var/run/docker.sock",
      startTimeoutMs: 30000,
      sessionIdleTimeoutMs: 2700000,
      envPassthroughPatterns: ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"],
      resources: {
        pids: 256,
        memoryMb: 2048,
        cpus: 2,
        storageMb: 4096
      }
    }
  },
  security: {
    jwtSecret: "secret",
    jwtTtl: "7d"
  },
  limits: {
    defaultTaskConcurrencyPerEnv: 4,
    maxConcurrentTasksWorkspace: 20
  },
  connectors: {
    telegram: { enabled: true },
    discord: { enabled: true },
    email: { enabled: true }
  },
  email: {
    enabled: true,
    appBaseUrl: "http://localhost:5173",
    queue: {
      maxAttempts: 5,
      retryBaseMs: 3000,
      globalRatePerMinute: 60
    },
    rateLimits: {
      signupVerificationPerHour: 5,
      signupResendCooldownSeconds: 60,
      forgotPasswordPerHour: 5,
      verificationAttemptsPerHour: 20
    }
  }
};

function writeTempConfig(relativeDir: string): { root: string; configPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-config-"));
  const dir = path.join(root, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "global.json");
  fs.writeFileSync(configPath, JSON.stringify(baseConfig, null, 2), "utf-8");
  return { root, configPath };
}

afterEach(() => {
  delete process.env.MEOWBERT_CONFIG_JSON;
  delete process.env.MEOWBERT_CONFIG_BASE64;
  delete process.env.MEOWBERT_SANDBOX_RUNTIME_IMAGE;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_HOST;
  delete process.env.DATABASE_PORT;
  delete process.env.DATABASE_USER;
  delete process.env.DATABASE_PASSWORD;
  delete process.env.DATABASE_NAME;
});

describe("loadConfig runtime path normalization", () => {
  it("loads without provider credentials and ignores legacy JSON credentials", () => {
    const temp = writeTempConfig("config");
    expect(loadConfig(temp.configPath).openai).toEqual({ defaultModel: "o4-mini" });
    fs.writeFileSync(temp.configPath, JSON.stringify({
      ...baseConfig,
      openai: { ...baseConfig.openai, apiKey: "legacy-secret", baseUrl: "https://legacy.test/v1" }
    }));
    expect(loadConfig(temp.configPath).openai).toEqual({ defaultModel: "o4-mini" });
    fs.rmSync(temp.root, { recursive: true, force: true });
  });

  it("resolves runtime roots from repository root when config is under config/", () => {
    const temp = writeTempConfig("config");
    const loaded = loadConfig(temp.configPath);

    expect(loaded.runtime.workspacesRoot).toBe(path.resolve(temp.root, "runtime/workspaces"));
    expect(loaded.runtime.environmentsRoot).toBe(path.resolve(temp.root, "runtime/environments"));
    expect(loaded.runtime.tasksRoot).toBe(path.resolve(temp.root, "runtime/tasks"));
    expect(loaded.memory?.indexCacheRoot).toBe("/tmp/meowbert-memory-index-cache");
    expect(loaded.runtime.sandbox.image).toBe("meowbert-sandbox-runtime:local");
  });

  it("does not retain the retired fastModel config key", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    const openai = raw.openai as Record<string, unknown>;
    openai.fastModel = "gpt-fast";
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);
    expect("fastModel" in loaded.openai).toBe(false);
  });

  it("preserves an explicit sandbox runtime override", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    const runtime = raw.runtime as Record<string, unknown>;
    const sandbox = runtime.sandbox as Record<string, unknown>;
    sandbox.runtime = "runsc";
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);

    expect(loaded.runtime.sandbox.runtime).toBe("runsc");
  });

  it("resolves runtime roots from config directory when config is outside config/", () => {
    const temp = writeTempConfig("custom");
    const loaded = loadConfig(temp.configPath);

    expect(loaded.runtime.workspacesRoot).toBe(path.resolve(temp.root, "custom/runtime/workspaces"));
    expect(loaded.runtime.environmentsRoot).toBe(path.resolve(temp.root, "custom/runtime/environments"));
    expect(loaded.runtime.tasksRoot).toBe(path.resolve(temp.root, "custom/runtime/tasks"));
  });
});

describe("loadConfig storage backend normalization", () => {
  it("synthesizes local-default and resolves custom backend paths from config", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    raw.storage = {
      defaultWorkspaceBackendId: "mounted-shared",
      backends: [
        {
          id: "mounted-shared",
          type: "mounted",
          mountPath: "./runtime/storage/mounted-shared",
          workspacesDir: "workspaces",
          environmentsDir: "environments"
        }
      ]
    };
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);
    const backendIds = loaded.storage.backends.map((backend) => backend.id);
    const mountedBackend = loaded.storage.backends.find((backend) => backend.id === "mounted-shared");

    expect(loaded.storage.defaultWorkspaceBackendId).toBe("mounted-shared");
    expect(backendIds).toContain("local-default");
    expect(backendIds).toContain("mounted-shared");
    expect(mountedBackend).toMatchObject({
      type: "mounted",
      mountPath: path.resolve(temp.root, "runtime/storage/mounted-shared"),
      workspacesDir: "workspaces",
      environmentsDir: "environments"
    });
  });
});

describe("loadConfig database env overrides", () => {
  it("uses DATABASE_URL when provided", () => {
    const temp = writeTempConfig("config");
    process.env.DATABASE_URL = "postgres://from-url:secret@db.internal:5433/override";

    const loaded = loadConfig(temp.configPath);

    expect(loaded.db.url).toBe("postgres://from-url:secret@db.internal:5433/override");
  });

  it("builds db url from DATABASE_* parts and safely encodes special characters", () => {
    const temp = writeTempConfig("config");
    process.env.DATABASE_URL = "postgres://ignored:url@127.0.0.1:5432/ignored";
    process.env.DATABASE_HOST = "db.internal";
    process.env.DATABASE_PORT = "5433";
    process.env.DATABASE_USER = "api-user";
    process.env.DATABASE_PASSWORD = "p@ss:word/with?symbols#1";
    process.env.DATABASE_NAME = "meowbert";

    const loaded = loadConfig(temp.configPath);

    const parsed = new URL(loaded.db.url);
    expect(parsed.protocol).toBe("postgres:");
    expect(parsed.hostname).toBe("db.internal");
    expect(parsed.port).toBe("5433");
    expect(parsed.username).toBe("api-user");
    expect(decodeURIComponent(parsed.password)).toBe("p@ss:word/with?symbols#1");
    expect(parsed.pathname).toBe("/meowbert");
  });
});

describe("loadConfig sandbox image env override", () => {
  it("uses MEOWBERT_SANDBOX_RUNTIME_IMAGE when provided", () => {
    const temp = writeTempConfig("config");
    process.env.MEOWBERT_SANDBOX_RUNTIME_IMAGE = "ghcr.io/xinthedark/meowbert-ai-agent/sandbox-runtime:main";

    const loaded = loadConfig(temp.configPath);

    expect(loaded.runtime.sandbox.image).toBe("ghcr.io/xinthedark/meowbert-ai-agent/sandbox-runtime:main");
  });
});

describe("loadConfig github settings", () => {
  it("loads github connector toggle", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    raw.github = {
      enabled: true
    };
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);
    expect(loaded.github?.enabled).toBe(true);
  });
});

describe("loadConfig web settings", () => {
  it("loads optional web appUrl", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    raw.web = {
      docsUrl: "https://docs.meowbert.example.com",
      appUrl: "https://meowbert.example.com"
    };
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);
    expect(loaded.web?.appUrl).toBe("https://meowbert.example.com");
    expect(loaded.web?.docsUrl).toBe("https://docs.meowbert.example.com");
  });
});

describe("loadConfig skill settings", () => {
  it("loads browser-use enablement toggle", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    raw.skills = {
      rootDir: "./skills",
      browserUse: {
        enabled: false
      },
      htmlCanvas: {
        enabled: true
      },
      office: {
        enabled: false
      }
    };
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);

    expect(loaded.skills?.rootDir).toBe(path.resolve(temp.root, "skills"));
    expect(loaded.skills?.browserUse?.enabled).toBe(false);
    expect(loaded.skills?.htmlCanvas?.enabled).toBe(true);
    expect(loaded.skills?.office?.enabled).toBe(false);
    expect(isBrowserUseEnabled(loaded)).toBe(false);
    expect(isHtmlCanvasEnabled(loaded)).toBe(true);
    expect(isOfficeEnabled(loaded)).toBe(false);
    expect(isSkillEnabledByConfig(loaded, "browser-use")).toBe(false);
    expect(isSkillEnabledByConfig(loaded, "html-canvas")).toBe(true);
    expect(isSkillEnabledByConfig(loaded, "docx-studio")).toBe(false);
    expect(isSkillEnabledByConfig(loaded, "pptx-studio")).toBe(false);
    expect(isSkillEnabledByConfig(loaded, "openai-doc")).toBe(true);
  });

  it("defaults browser-use to enabled when omitted", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    raw.skills = {
      rootDir: "./skills"
    };
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);

    expect(isBrowserUseEnabled(loaded)).toBe(true);
    expect(isHtmlCanvasEnabled(loaded)).toBe(false);
    expect(isOfficeEnabled(loaded)).toBe(true);
    expect(isSkillEnabledByConfig(loaded, "browser-use")).toBe(true);
    expect(isSkillEnabledByConfig(loaded, "html-canvas")).toBe(false);
    expect(isSkillEnabledByConfig(loaded, "docx-studio")).toBe(true);
    expect(isSkillEnabledByConfig(loaded, "pptx-studio")).toBe(true);
  });
});


describe("loadConfig memory embeddings settings", () => {
  it("loads memory embedding overrides", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    raw.memory = {
      embeddings: {
        mode: "ollama",
        model: "nomic-embed-text",
        host: "http://127.0.0.1:11434",
        queryPromptTemplate: "query: "
      }
    };
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);

    expect(loaded.memory?.embeddings?.mode).toBe("ollama");
    expect(loaded.memory?.embeddings?.model).toBe("nomic-embed-text");
    expect(loaded.memory?.embeddings?.host).toBe("http://127.0.0.1:11434");
    expect(loaded.memory?.embeddings?.queryPromptTemplate).toBe("query: ");
  });

  it("resolves a custom local memory index cache root", () => {
    const temp = writeTempConfig("config");
    const raw = JSON.parse(fs.readFileSync(temp.configPath, "utf-8")) as Record<string, unknown>;
    raw.memory = {
      indexCacheRoot: "./runtime/local-memory-cache"
    };
    fs.writeFileSync(temp.configPath, JSON.stringify(raw, null, 2), "utf-8");

    const loaded = loadConfig(temp.configPath);

    expect(loaded.memory?.indexCacheRoot).toBe(path.resolve(temp.root, "runtime/local-memory-cache"));
  });

  it("applies MEOWBERT_REDIS_PASSWORD environment override to redis.url", () => {
    const temp = writeTempConfig("config");
    const previous = process.env.MEOWBERT_REDIS_PASSWORD;
    process.env.MEOWBERT_REDIS_PASSWORD = "super_secret_redis_pw";

    try {
      const loaded = loadConfig(temp.configPath);
      expect(loaded.redis.url).toBe("redis://:super_secret_redis_pw@127.0.0.1:6379");
    } finally {
      if (previous === undefined) {
        delete process.env.MEOWBERT_REDIS_PASSWORD;
      } else {
        process.env.MEOWBERT_REDIS_PASSWORD = previous;
      }
    }
  });
});
