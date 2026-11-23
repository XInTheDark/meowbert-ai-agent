import type { ModelUsageCounts } from "@meowbert/shared";
import type { BridgeSession } from "@meowbert/run-executor/bridge/index";
import { AcpJsonRpcClient } from "./acp-jsonrpc-client.js";
import {
  buildAgyContinuationNudgePrompt,
  buildAgyInitialPrompt,
  decideAcpPermission,
  extractAgyTierMeta,
  matchConfigOptionValue,
  parseAgyUsageCounts,
  type AcpPermissionRequestParams
} from "./agy-acp-protocol.js";
import {
  AGY_BRIDGE_MCP_SERVER_NAME,
  getAllowedAgyBridgeToolNames,
  type WorkerBridgeHost
} from "./agy-bridge-host.js";
import type { HydratedAgyProfile } from "./agy-profile-dir.js";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HARD_TURN_TIMEOUT_MS = 30 * 60 * 1000;
const CANCEL_ESCALATION_TIMEOUT_MS = 10_000;
const MAX_END_TURN_NUDGES = 2;

export interface AgyAcpDriverOptions {
  command?: string;
  extraArgs?: string[];
  profile: HydratedAgyProfile;
  bridgeHost: WorkerBridgeHost;
  bridgeSession: BridgeSession;
  sessionCode: string;
  agyModel?: string | null;
  agyThinkingLevel?: string | null;
  handshakeTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  hardTurnTimeoutMs?: number;
  maxEndTurnNudges?: number;
  onUsage?: (counts: ModelUsageCounts) => Promise<void> | void;
  onLog?: (message: string, meta?: Record<string, unknown>) => void;
}

export class AgyAcpDriver {
  private readonly options: AgyAcpDriverOptions;
  private readonly allowedTools = getAllowedAgyBridgeToolNames();
  private client: AcpJsonRpcClient | null = null;
  private acpSessionId: string | null = null;
  private tierName: string | null = null;
  private tierId: string | null = null;
  private stopped = false;
  private turnCancelled = false;
  private inFlightMcpCalls = 0;
  private unsubscribeToolActivity: (() => void) | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private hardTurnTimer: NodeJS.Timeout | null = null;
  private cancelEscalationTimer: NodeJS.Timeout | null = null;
  private runPromise: Promise<void> | null = null;

  constructor(options: AgyAcpDriverOptions) {
    this.options = options;
  }

  start(): Promise<void> {
    if (this.runPromise) return this.runPromise;
    this.runPromise = this.execute();
    return this.runPromise;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.turnCancelled = true;
    this.clearTimers();
    this.unsubscribeToolActivity?.();
    this.unsubscribeToolActivity = null;
    if (this.client && this.acpSessionId && !this.client.isClosed()) {
      this.client.notify("session/cancel", { sessionId: this.acpSessionId });
    }
    if (this.client) {
      await this.client.closeGracefully(this.acpSessionId);
    }
    await this.options.profile.cleanupAndSync({ tierName: this.tierName, tierId: this.tierId });
  }

  private clearTimers(): void {
    if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; }
    if (this.hardTurnTimer) { clearTimeout(this.hardTurnTimer); this.hardTurnTimer = null; }
    if (this.cancelEscalationTimer) { clearTimeout(this.cancelEscalationTimer); this.cancelEscalationTimer = null; }
  }

  private resetInactivityWatchdog(): void {
    if (this.stopped || !this.acpSessionId || this.inFlightMcpCalls > 0) return;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    const timeoutMs = this.options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.inactivityTimer = setTimeout(() => {
      this.triggerWatchdogCancel(`Antigravity ACP stalled with no activity for ${Math.round(timeoutMs / 1000)}s.`);
    }, timeoutMs);
  }

  private handleBridgeToolActivity(phase: "start" | "end"): void {
    if (phase === "start") {
      this.inFlightMcpCalls += 1;
      if (this.inactivityTimer) {
        clearTimeout(this.inactivityTimer);
        this.inactivityTimer = null;
      }
      return;
    }
    this.inFlightMcpCalls = Math.max(0, this.inFlightMcpCalls - 1);
    if (this.inFlightMcpCalls === 0) {
      this.resetInactivityWatchdog();
    }
  }

  private armHardTurnTimeout(): void {
    if (this.hardTurnTimer) clearTimeout(this.hardTurnTimer);
    const timeoutMs = this.options.hardTurnTimeoutMs ?? DEFAULT_HARD_TURN_TIMEOUT_MS;
    this.hardTurnTimer = setTimeout(() => {
      this.triggerWatchdogCancel(`Antigravity ACP turn exceeded hard limit of ${Math.round(timeoutMs / 1000)}s.`);
    }, timeoutMs);
  }

  private triggerWatchdogCancel(reason: string): void {
    if (this.turnCancelled) return;
    this.turnCancelled = true;
    this.options.onLog?.(reason);
    if (this.client && this.acpSessionId && !this.client.isClosed()) {
      this.client.notify("session/cancel", { sessionId: this.acpSessionId });
    }
    this.cancelEscalationTimer = setTimeout(() => {
      this.client?.kill();
    }, CANCEL_ESCALATION_TIMEOUT_MS);
    this.options.bridgeSession.fail(reason);
  }

  private async execute(): Promise<void> {
    const command = this.options.command ?? (process.env.MEOWBERT_AGY_BIN?.trim() || "agy");
    const args = this.options.extraArgs ?? [
      "acp",
      "--process-per-session",
      "--agent", "mcp-only",
      "--include-default-customizations=false",
      "--dangerously-skip-permissions",
      "--disable-telemetry",
      "--log-file", this.options.profile.logFilePath
    ];

    this.unsubscribeToolActivity = this.options.bridgeHost.onSessionToolActivity(
      this.options.sessionCode,
      (_toolName, phase) => this.handleBridgeToolActivity(phase)
    );

    let lastError: string | null = null;
    try {
      this.client = new AcpJsonRpcClient({
        command,
        args,
        cwd: this.options.profile.cwdDir,
        env: {
          ...process.env,
          HOME: this.options.profile.homeDir,
          AGY_CLI_DISABLE_AUTO_UPDATE: "true"
        },
        onRequest: async (request) => this.handleAgentRequest(request.method, request.params),
        onNotification: (notification) => {
          if (notification.method === "session/update") {
            this.resetInactivityWatchdog();
          }
        },
        onUnexpectedExit: (error) => {
          if (!this.stopped) {
            this.options.bridgeSession.fail(error.message);
          }
        }
      });

      const handshakeTimeout = this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
      await this.client.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "meowbert", version: "1.0.0" },
        clientCapabilities: {}
      }, handshakeTimeout);

      const newSession = await this.client.request<Record<string, unknown>>("session/new", {
        cwd: this.options.profile.cwdDir,
        mcpServers: [{
          type: "http",
          name: AGY_BRIDGE_MCP_SERVER_NAME,
          url: this.options.bridgeHost.endpointUrl,
          headers: [
            { name: "Authorization", value: `Bearer ${this.options.bridgeHost.bearerToken}` },
            { name: "X-Meowbert-Session-Code", value: this.options.sessionCode }
          ]
        }]
      }, handshakeTimeout);

      const sessionId = typeof newSession.sessionId === "string" ? newSession.sessionId : null;
      if (!sessionId) throw new Error("Antigravity ACP session/new did not return a sessionId.");
      this.acpSessionId = sessionId;

      const tier = extractAgyTierMeta(newSession);
      this.tierName = tier.tierName;
      this.tierId = tier.tierId;

      await this.applyModelAndThinkingOptions(sessionId, newSession.configOptions, handshakeTimeout);
      await this.drivePromptTurns(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (!this.stopped) {
        this.options.bridgeSession.fail(message);
      }
    } finally {
      this.clearTimers();
      this.unsubscribeToolActivity?.();
      this.unsubscribeToolActivity = null;
      if (this.client) {
        await this.client.closeGracefully(this.acpSessionId).catch(() => undefined);
      }
      await this.options.profile.cleanupAndSync({
        tierName: this.tierName,
        tierId: this.tierId,
        lastError
      });
    }
  }

  private async handleAgentRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== "session/request_permission") {
      throw new Error(`Unsupported ACP client request: ${method}`);
    }
    const decision = decideAcpPermission({
      params: (params ?? {}) as AcpPermissionRequestParams,
      activeSessionId: this.acpSessionId,
      allowedToolNames: this.allowedTools,
      turnCancelled: this.turnCancelled
    });
    if (decision.shouldCancelTurn && this.acpSessionId) {
      this.triggerWatchdogCancel("Denied disallowed Antigravity tool call without a reject option.");
    }
    return decision.response;
  }

  private async applyModelAndThinkingOptions(
    sessionId: string,
    initialConfigOptions: unknown,
    timeoutMs: number
  ): Promise<void> {
    let configOptions = initialConfigOptions;
    if (this.options.agyModel) {
      const matchedModel = matchConfigOptionValue(configOptions, "model", this.options.agyModel) ?? this.options.agyModel;
      const updated = await this.client!.request<Record<string, unknown>>(
        "session/set_config_option",
        { sessionId, configId: "model", value: matchedModel },
        timeoutMs
      );
      if (updated?.configOptions) configOptions = updated.configOptions;
    }

    if (this.options.agyThinkingLevel) {
      const matchedThought = matchConfigOptionValue(configOptions, "thought_level", this.options.agyThinkingLevel);
      if (matchedThought) {
        await this.client!.request(
          "session/set_config_option",
          { sessionId, configId: "thought_level", value: matchedThought },
          timeoutMs
        );
      }
    }
  }

  private async drivePromptTurns(sessionId: string): Promise<void> {
    const maxNudges = this.options.maxEndTurnNudges ?? MAX_END_TURN_NUDGES;
    let promptText = buildAgyInitialPrompt();

    for (let turn = 0; turn <= maxNudges; turn += 1) {
      if (this.stopped || this.isBridgeTerminal()) return;
      this.turnCancelled = false;
      this.resetInactivityWatchdog();
      this.armHardTurnTimeout();

      const result = await this.client!.request<Record<string, unknown>>("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: promptText }]
      });
      this.clearTimers();

      const usage = parseAgyUsageCounts(result?.usage);
      if (usage) {
        await this.options.onUsage?.(usage);
      }

      if (this.stopped || this.isBridgeTerminal()) return;
      const stopReason = typeof result?.stopReason === "string" ? result.stopReason : "unknown";
      if (stopReason === "cancelled") {
        this.options.bridgeSession.fail("Antigravity ACP turn was cancelled.");
        return;
      }
      if (turn === maxNudges) {
        this.options.bridgeSession.fail(`Antigravity ACP ended (${stopReason}) without calling meowbert_final_response.`);
        return;
      }
      promptText = buildAgyContinuationNudgePrompt();
    }
  }

  private isBridgeTerminal(): boolean {
    const status = this.options.bridgeSession.getStatus();
    return status === "completed" || status === "cancelled" || status === "parked";
  }
}
