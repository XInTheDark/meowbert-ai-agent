import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { sandboxConfigSchema } from "./sandbox.js";
import { storageConfigSchema, type NormalizedStorageConfig, normalizeStorageConfig } from "./storage-backends.js";
import {
  taskHistoryArchiveConfigInputSchema,
  type NormalizedTaskHistoryArchiveConfig,
  normalizeTaskHistoryArchiveConfig
} from "./task-history-archive.js";

const memoryEmbeddingModeSchema = z.enum(["openai", "ollama", "sentence-transformers", "mlx"]);
const DEFAULT_MEMORY_INDEX_CACHE_ROOT = "/tmp/meowbert-memory-index-cache";
const browserUseConfigSchema = z.object({
  enabled: z.boolean().optional()
});
const htmlCanvasConfigSchema = z.object({
  enabled: z.boolean().optional()
});
const officeConfigSchema = z.object({
  enabled: z.boolean().optional()
});
const webPushConfigSchema = z.object({
  enabled: z.boolean().optional(),
  vapidPublicKey: z.string().min(1).optional(),
  vapidPrivateKey: z.string().min(1).optional(),
  contactEmail: z.string().optional()
});
const meilisearchConfigSchema = z.object({
  host: z.string().url(),
  apiKey: z.string().min(1).optional(),
  indexUid: z.string().min(1).optional(),
  syncBatchSize: z.number().int().positive().optional(),
  syncIntervalMs: z.number().int().positive().optional()
});

const configSchema = z.object({
  storage: storageConfigSchema,
  server: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    publicUrl: z.string().url(),
    internalUrl: z.string().url().optional()
  }),
  db: z.object({
    url: z.string().min(1),
    autoCreateOnStartup: z.boolean().optional(),
    requireExistingSchemaOnStartup: z.boolean().optional()
  }),
  redis: z.object({
    url: z.string().min(1)
  }),
  search: z.object({
    meilisearch: meilisearchConfigSchema
  }).optional(),
  openai: z.object({
    defaultModel: z.string().min(1)
  }),
  memory: z.object({
    indexCacheRoot: z.string().min(1).optional(),
    embeddings: z.object({
      mode: memoryEmbeddingModeSchema.optional(),
      model: z.string().min(1).optional(),
      baseUrl: z.string().url().optional(),
      apiKey: z.string().min(1).optional(),
      host: z.string().url().optional(),
      buildPromptTemplate: z.string().optional(),
      queryPromptTemplate: z.string().optional()
    }).optional()
  }).optional(),
  runtime: z.object({
    shell: z.string().min(1),
    workspacesRoot: z.string().min(1),
    environmentsRoot: z.string().min(1),
    tasksRoot: z.string().min(1),
    commandTimeoutMs: z.number().int().positive(),
    maxCommandOutputKb: z.number().int().positive(),
    maxSteps: z.number().int().positive(),
    workerConcurrency: z.number().int().positive(),
    sandbox: sandboxConfigSchema
  }),
  security: z.object({
    jwtSecret: z.string().min(1),
    jwtTtl: z.string().min(1)
  }),
  limits: z.object({
    defaultTaskConcurrencyPerEnv: z.number().int().positive(),
    maxConcurrentTasksWorkspace: z.number().int().positive(),
    maxActiveRecurringTasksPerEnv: z.number().int().positive().optional(),
    maxActiveRecurringTasksWorkspace: z.number().int().positive().optional()
  }),
  connectors: z.object({
    telegram: z.object({
      enabled: z.boolean()
    }),
    discord: z.object({
      enabled: z.boolean()
    }),
    email: z.object({
      enabled: z.boolean()
    })
  }),
  email: z.object({
    enabled: z.boolean(),
    appBaseUrl: z.string().url(),
    queue: z.object({
      maxAttempts: z.number().int().positive(),
      retryBaseMs: z.number().int().positive(),
      globalRatePerMinute: z.number().int().positive()
    }),
    rateLimits: z.object({
      signupVerificationPerHour: z.number().int().positive(),
      signupResendCooldownSeconds: z.number().int().positive(),
      forgotPasswordPerHour: z.number().int().positive(),
      verificationAttemptsPerHour: z.number().int().positive()
    })
  }),
  github: z.object({
    enabled: z.boolean()
  }).optional(),
  web: z.object({
    docsUrl: z.string().url().optional(),
    appUrl: z.string().url().optional()
  }).optional(),
  deployment: z.object({
    meowbertPostgresDataPath: z.string().min(1).optional(),
    meowbertPostgresBackupPath: z.string().min(1).optional()
  }).optional(),
  taskHistoryArchive: taskHistoryArchiveConfigInputSchema,
  skills: z.object({
    rootDir: z.string().min(1),
    browserUse: browserUseConfigSchema.optional(),
    htmlCanvas: htmlCanvasConfigSchema.optional(),
    office: officeConfigSchema.optional()
  }).optional(),
  webPush: webPushConfigSchema.optional()
});

type ParsedAppConfig = z.infer<typeof configSchema>;

export type AppConfig = Omit<ParsedAppConfig, "storage" | "taskHistoryArchive"> & {
  storage: NormalizedStorageConfig;
  taskHistoryArchive: NormalizedTaskHistoryArchiveConfig;
};

function resolveConfigBaseDir(configPath: string): string {
  const configDir = path.dirname(configPath);
  if (path.basename(configDir) === "config") {
    return path.resolve(configDir, "..");
  }

  return configDir;
}

function normalizeRuntimePaths(parsed: ParsedAppConfig, baseDir: string): AppConfig {
  const runtime = {
    ...parsed.runtime,
    workspacesRoot: resolvePathFromRoot(baseDir, parsed.runtime.workspacesRoot),
    environmentsRoot: resolvePathFromRoot(baseDir, parsed.runtime.environmentsRoot),
    tasksRoot: resolvePathFromRoot(baseDir, parsed.runtime.tasksRoot)
  };

  return {
    ...parsed,
    storage: normalizeStorageConfig({
      baseDir,
      workspacesRoot: runtime.workspacesRoot,
      environmentsRoot: runtime.environmentsRoot,
      rawStorage: parsed.storage
    }),
    taskHistoryArchive: normalizeTaskHistoryArchiveConfig({
      baseDir,
      rawTaskHistoryArchive: parsed.taskHistoryArchive
    }),
    openai: parsed.openai,
    memory: {
      ...parsed.memory,
      indexCacheRoot: resolvePathFromRoot(baseDir, parsed.memory?.indexCacheRoot ?? DEFAULT_MEMORY_INDEX_CACHE_ROOT)
    },
    runtime,
    ...(parsed.skills ? {
      skills: {
        ...parsed.skills,
        rootDir: resolvePathFromRoot(baseDir, parsed.skills.rootDir)
      }
    } : {})
  };
}

function resolveConfigPath(configPath?: string): string {
  if (configPath) {
    return configPath;
  }

  const explicitPath = process.env.MEOWBERT_CONFIG_PATH;
  if (explicitPath) {
    return explicitPath;
  }

  const candidates = [
    path.resolve(process.cwd(), "config/global.json"),
    path.resolve(process.cwd(), "../config/global.json"),
    path.resolve(process.cwd(), "../../config/global.json")
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Could not locate config/global.json. Tried: ${candidates.join(", ")}`);
  }

  return found;
}

function buildDatabaseUrlFromEnvParts(): string | null {
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT;
  const user = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;
  const database = process.env.DATABASE_NAME;

  if (!host && !port && !user && !password && !database) {
    return null;
  }

  const url = new URL("postgres://127.0.0.1:5432/postgres");
  if (host) {
    url.hostname = host;
  }
  if (port) {
    url.port = port;
  }
  if (user) {
    url.username = user;
  }
  if (password !== undefined) {
    url.password = password;
  }
  if (database) {
    url.pathname = `/${database}`;
  }

  return url.toString();
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  let nextConfig = config;
  const databaseUrlFromParts = buildDatabaseUrlFromEnvParts();
  if (databaseUrlFromParts) {
    nextConfig = { ...nextConfig, db: { ...nextConfig.db, url: databaseUrlFromParts } };
  }
  else {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      nextConfig = { ...nextConfig, db: { ...nextConfig.db, url: databaseUrl } };
    }
  }

  const redisUrl = process.env.REDIS_URL || process.env.MEOWBERT_REDIS_URL;
  if (redisUrl) {
    nextConfig = { ...nextConfig, redis: { ...nextConfig.redis, url: redisUrl } };
  } else if (process.env.MEOWBERT_REDIS_PASSWORD) {
    try {
      const parsedRedisUrl = new URL(nextConfig.redis.url);
      parsedRedisUrl.password = process.env.MEOWBERT_REDIS_PASSWORD;
      nextConfig = { ...nextConfig, redis: { ...nextConfig.redis, url: parsedRedisUrl.toString() } };
    } catch {
      // Keep existing url if unparseable
    }
  }

  const sandboxRuntimeImage = process.env.MEOWBERT_SANDBOX_RUNTIME_IMAGE?.trim();
  if (sandboxRuntimeImage) {
    nextConfig = {
      ...nextConfig,
      runtime: {
        ...nextConfig.runtime,
        sandbox: {
          ...nextConfig.runtime.sandbox,
          image: sandboxRuntimeImage
        }
      }
    };
  }

  const meilisearchHost = process.env.MEOWBERT_MEILISEARCH_HOST?.trim();
  const meilisearchApiKey = process.env.MEOWBERT_MEILISEARCH_API_KEY?.trim();
  const meilisearchMasterKey = process.env.MEOWBERT_MEILISEARCH_MASTER_KEY?.trim();
  if (meilisearchHost || meilisearchApiKey || meilisearchMasterKey) {
    nextConfig = {
      ...nextConfig,
      search: {
        ...nextConfig.search,
        meilisearch: {
          host: meilisearchHost ?? nextConfig.search?.meilisearch.host ?? "http://127.0.0.1:7700",
          apiKey: meilisearchApiKey ?? meilisearchMasterKey ?? nextConfig.search?.meilisearch.apiKey,
          indexUid: nextConfig.search?.meilisearch.indexUid,
          syncBatchSize: nextConfig.search?.meilisearch.syncBatchSize,
          syncIntervalMs: nextConfig.search?.meilisearch.syncIntervalMs
        }
      }
    };
  }

  return nextConfig;
}

export function loadConfig(configPath?: string): AppConfig {
  // For stable base-dir resolution when using env-var JSON configs, try to locate a config
  // file the same way file-based loading would – this avoids process.cwd() differences
  // between services (API vs worker) that would cause them to resolve relative runtime paths
  // to different absolute paths.
  function stableBaseDir(): string {
    try {
      const filePath = resolveConfigPath();
      return resolveConfigBaseDir(filePath);
    } catch {
      return process.cwd();
    }
  }

  const envConfig = process.env.MEOWBERT_CONFIG_JSON;
  if (envConfig) {
    try {
      const parsed = JSON.parse(envConfig);
      return applyEnvOverrides(normalizeRuntimePaths(configSchema.parse(parsed), stableBaseDir()));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("MEOWBERT_CONFIG_JSON contains invalid JSON.");
      }
      throw error;
    }
  }

  const envConfigBase64 = process.env.MEOWBERT_CONFIG_BASE64;
  if (envConfigBase64) {
    try {
      const raw = Buffer.from(envConfigBase64, "base64").toString("utf-8");
      const parsed = JSON.parse(raw);
      return applyEnvOverrides(normalizeRuntimePaths(configSchema.parse(parsed), stableBaseDir()));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("MEOWBERT_CONFIG_BASE64 decodes to invalid JSON.");
      }
      throw error;
    }
  }

  const resolvedPath = resolveConfigPath(configPath);
  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const config = configSchema.parse(parsed);
  return applyEnvOverrides(normalizeRuntimePaths(config, resolveConfigBaseDir(resolvedPath)));
}

export function resolvePathFromRoot(root: string, maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(root, maybeRelative);
}

type SkillToggleConfig =
  | Pick<AppConfig, "skills">
  | { skills?: { browserUse?: { enabled?: boolean }; htmlCanvas?: { enabled?: boolean }; office?: { enabled?: boolean } } };

const OFFICE_SKILL_IDS = new Set([
  "docx-studio",
  "pptx-studio"
]);

export function isBrowserUseEnabled(config: SkillToggleConfig): boolean {
  return config.skills?.browserUse?.enabled !== false;
}

export function isHtmlCanvasEnabled(config: SkillToggleConfig): boolean {
  return config.skills?.htmlCanvas?.enabled === true;
}

export function isOfficeEnabled(config: SkillToggleConfig): boolean {
  return config.skills?.office?.enabled !== false;
}

export function isSkillEnabledByConfig(config: SkillToggleConfig, skillId: string): boolean {
  if (skillId === "browser-use") {
    return isBrowserUseEnabled(config);
  }
  if (skillId === "html-canvas") {
    return isHtmlCanvasEnabled(config);
  }
  if (OFFICE_SKILL_IDS.has(skillId)) {
    return isOfficeEnabled(config);
  }
  return true;
}
