import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBatchDownloadUrl,
  buildDownloadUrl,
  buildWorkspaceBatchDownloadUrl,
  formatRelative,
  getEffectiveTaskStatus,
  getEnvironmentJsonPayload,
  getEnvironmentPersonalityId,
  getEnvironmentPersonalityOverrideId,
  getProjectContextNotes,
  getEnvironmentSystemPromptOverride,
  getSandboxNetworkEnabled,
  getSandboxNetworkEnabledOverride,
  joinTaskMessage,
  getNetworkRequestLoggingEnabled,
  getTaskCleanupExpirationDays,
  normalizeEnvironmentJsonPayload,
  setEnvironmentSystemPromptOverride,
  setEnvironmentPersonalityId,
  setSandboxNetworkEnabled,
  setSandboxNetworkEnabledOverride,
  setNetworkRequestLoggingEnabled,
  setTaskCleanupExpirationDays
} from "./utils";
import { buildTaskListGridTemplate } from "../pages/environment/overview/environmentOverviewUtils";

describe("formatRelative", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats past timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T05:00:00.000Z"));

    expect(formatRelative("2026-02-28T04:59:30.000Z")).toBe("30s ago");
    expect(formatRelative("2026-02-28T04:30:00.000Z")).toBe("30m ago");
  });

  it("formats future timestamps without negative values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T05:00:00.000Z"));

    expect(formatRelative("2026-02-28T05:00:24.000Z")).toBe("in 24s");
    expect(formatRelative("2026-02-28T06:00:00.000Z")).toBe("in 1h");
  });
});

describe("joinTaskMessage", () => {
  it("labels directory attachments distinctly", () => {
    expect(
      joinTaskMessage("Review this", [
        {
          id: "dir-1",
          kind: "directory",
          label: "docs",
          content: "docs",
          relativePath: "docs"
        }
      ])
    ).toBe("Review this\n\nAttached context:\n- directory: docs");
  });

  it("marks force-included attachments in the rendered prompt text", () => {
    expect(
      joinTaskMessage("Review this", [
        {
          id: "file-1",
          kind: "file",
          label: "notes.txt",
          content: "inputs/notes.txt",
          relativePath: "inputs/notes.txt",
          forceInclude: true
        }
      ])
    ).toBe("Review this\n\nAttached context:\n- file: inputs/notes.txt [force include]");
  });
});

describe("getEffectiveTaskStatus", () => {
  it("shows cancelling agent swarm parents as interrupting instead of running", () => {
    expect(getEffectiveTaskStatus({
      taskStatus: "queued",
      cancellationRequested: true,
      workflow: {
        type: "agent_swarm",
        phase: "active",
        config: {},
        agentSwarm: {
          workerCount: 2,
          channels: [],
          workers: [
            {
              workflow_agent_id: "agent-1",
              task_id: "task-1",
              slot_index: 0,
              title: "Worker 1",
              status: "running",
              updated_at: "2026-03-17T00:00:00.000Z"
            },
            {
              workflow_agent_id: "agent-2",
              task_id: "task-2",
              slot_index: 1,
              title: "Worker 2",
              status: "queued",
              updated_at: "2026-03-17T00:00:00.000Z"
            }
          ]
        }
      }
    })).toBe("interrupting");
  });

  it("keeps cancelled agent swarm parents cancelled even before the workflow phase flips", () => {
    expect(getEffectiveTaskStatus({
      taskStatus: "cancelled",
      workflow: {
        type: "agent_swarm",
        phase: "active",
        config: {},
        agentSwarm: {
          workerCount: 2,
          channels: [],
          workers: [
            {
              workflow_agent_id: "agent-1",
              task_id: "task-1",
              slot_index: 0,
              title: "Worker 1",
              status: "running",
              updated_at: "2026-03-17T00:00:00.000Z"
            },
            {
              workflow_agent_id: "agent-2",
              task_id: "task-2",
              slot_index: 1,
              title: "Worker 2",
              status: "queued",
              updated_at: "2026-03-17T00:00:00.000Z"
            }
          ]
        }
      }
    })).toBe("cancelled");
  });

  it("keeps agent swarm parents running while workers are still active", () => {
    expect(getEffectiveTaskStatus({
      taskStatus: "succeeded",
      workflow: {
        type: "agent_swarm",
        phase: "active",
        config: {},
        agentSwarm: {
          workerCount: 2,
          channels: [],
          workers: [
            {
              workflow_agent_id: "agent-1",
              task_id: "task-1",
              slot_index: 0,
              title: "Worker 1",
              status: "running",
              updated_at: "2026-03-17T00:00:00.000Z"
            },
            {
              workflow_agent_id: "agent-2",
              task_id: "task-2",
              slot_index: 1,
              title: "Worker 2",
              status: "cancelled",
              updated_at: "2026-03-17T00:00:00.000Z"
            }
          ]
        }
      }
    })).toBe("running");
  });

  it("shows active agent swarm parents as running even while workers are queued", () => {
    expect(getEffectiveTaskStatus({
      taskStatus: "queued",
      workflow: {
        type: "agent_swarm",
        phase: "active",
        config: {},
        agentSwarm: {
          workerCount: 2,
          channels: [],
          workers: [
            {
              workflow_agent_id: "agent-1",
              task_id: "task-1",
              slot_index: 0,
              title: "Worker 1",
              status: "queued",
              updated_at: "2026-03-17T00:00:00.000Z"
            },
            {
              workflow_agent_id: "agent-2",
              task_id: "task-2",
              slot_index: 1,
              title: "Worker 2",
              status: "queued",
              updated_at: "2026-03-17T00:00:00.000Z"
            }
          ]
        }
      }
    })).toBe("running");
  });

  it("lets completed agent swarm parents stay succeeded once workers are no longer active", () => {
    expect(getEffectiveTaskStatus({
      taskStatus: "succeeded",
      workflow: {
        type: "agent_swarm",
        phase: "completed",
        config: {},
        agentSwarm: {
          workerCount: 2,
          channels: [],
          workers: [
            {
              workflow_agent_id: "agent-1",
              task_id: "task-1",
              slot_index: 0,
              title: "Worker 1",
              status: "cancelled",
              updated_at: "2026-03-17T00:00:00.000Z"
            },
            {
              workflow_agent_id: "agent-2",
              task_id: "task-2",
              slot_index: 1,
              title: "Worker 2",
              status: "succeeded",
              updated_at: "2026-03-17T00:00:00.000Z"
            }
          ]
        }
      }
    })).toBe("succeeded");
  });
});

describe("buildTaskListGridTemplate", () => {
  it("keeps the task column flexible while using pixel widths for the rest", () => {
    expect(
      buildTaskListGridTemplate({
        task: 320,
        status: 132,
        updated: 120,
        created: 120,
        actions: 96
      })
    ).toBe("36px minmax(320px, 1fr) 132px 120px 120px 96px");
  });
});

describe("project json payload normalization", () => {
  it("drops max_context_window_tokens and normalizes store", () => {
    expect(
      normalizeEnvironmentJsonPayload({
        reasoning: { effort: "high" },
        max_context_window_tokens: 256000
      })
    ).toEqual({
      responses: {
        reasoning: { effort: "high" }
      }
    });
  });

  it("strips max_context_window_tokens from project payloads", () => {
    expect(
      getEnvironmentJsonPayload({
        id: "env-1",
        workspace_id: "ws-1",
        name: "Test",
        root_path: "/tmp",
        status: "active",
        json_payload: {
          store: true,
          max_context_window_tokens: 128000
        },
        created_at: "2026-02-28T05:00:00.000Z"
      })
    ).toEqual({
      responses: {
        store: true
      }
    });
  });

  it("normalizes task cleanup expiration days", () => {
    expect(
      normalizeEnvironmentJsonPayload({
        store: false,
        task_cleanup: {
          expiration_days: 30.7
        }
      })
    ).toEqual({
      responses: {
        store: false
      },
      task_cleanup: {
        expiration_days: 30
      }
    });
  });

  it("removes invalid task cleanup expiration values", () => {
    expect(
      normalizeEnvironmentJsonPayload({
        store: false,
        task_cleanup: {
          expiration_days: 0
        }
      })
    ).toEqual({
      responses: {
        store: false
      }
    });
  });

  it("normalizes debug network request logging key", () => {
    expect(
      normalizeEnvironmentJsonPayload({
        store: false,
        debug: {
          logNetworkRequests: true
        }
      })
    ).toEqual({
      responses: {
        store: false
      },
      debug: {
        log_network_requests: true
      }
    });
  });

  it("normalizes sandbox network setting to sparse false-only form", () => {
    expect(
      normalizeEnvironmentJsonPayload({
        store: false,
        sandbox: {
          networkEnabled: false
        }
      })
    ).toEqual({
      responses: {
        store: false
      },
      sandbox: {
        network_enabled: false
      }
    });
  });

  it("preserves an explicit allow sandbox override during normalization", () => {
    expect(
      normalizeEnvironmentJsonPayload({
        sandbox: {
          networkEnabled: true
        }
      })
    ).toEqual({
      sandbox: {
        network_enabled: true
      }
    });
  });

  it("preserves persistent runtime settings at the project payload root", () => {
    expect(
      normalizeEnvironmentJsonPayload({
        persistent_runtime: {
          enabled: true
        }
      })
    ).toEqual({
      persistent_runtime: {
        enabled: true
      }
    });

    expect(
      normalizeEnvironmentJsonPayload({
        persistent_runtime: {
          enabled: false
        }
      })
    ).toEqual({
      persistent_runtime: {
        enabled: false
      }
    });
  });

  it("preserves project context notes at the top level", () => {
    const payload = normalizeEnvironmentJsonPayload({
      store: false,
      project_context: {
        notes: {
          "context/docs/spec.md": "Read this before editing."
        }
      }
    });

    expect(payload).toEqual({
      responses: {
        store: false
      },
      project_context: {
        notes: {
          "context/docs/spec.md": "Read this before editing."
        }
      }
    });
    expect(getProjectContextNotes(payload)).toEqual({
      "context/docs/spec.md": "Read this before editing."
    });
  });
});

describe("project system prompt helpers", () => {
  it("reads and writes the project system prompt override", () => {
    const updated = setEnvironmentSystemPromptOverride({}, "Use markdown.");
    expect(getEnvironmentSystemPromptOverride(updated)).toBe("Use markdown.");
    expect(updated).toEqual({
      default_context: {
        system_prompt: "Use markdown."
      }
    });

    expect(setEnvironmentSystemPromptOverride(updated, null)).toEqual({});
  });
});

describe("project personality helpers", () => {
  it("resolves configured personality id when available", () => {
    expect(
      getEnvironmentPersonalityId(
        {
          default_context: {
            personality: "friendly"
          }
        },
        {
          availableIds: ["default", "friendly", "none"],
          defaultId: "default"
        }
      )
    ).toBe("friendly");
  });

  it("falls back to default personality when configured value is invalid", () => {
    expect(
      getEnvironmentPersonalityId(
        {
          default_context: {
            personality: "missing"
          }
        },
        {
          availableIds: ["default", "friendly", "none"],
          defaultId: "default"
        }
      )
    ).toBe("default");
  });

  it("writes personality id and preserves existing default_context fields", () => {
    expect(
      setEnvironmentPersonalityId(
        {
          responses: {
            store: false
          },
          default_context: {
            system_prompt: "Use concise answers"
          }
        },
        "cold"
      )
    ).toEqual({
      responses: {
        store: false
      },
      default_context: {
        system_prompt: "Use concise answers",
        personality: "cold"
      }
    });
  });

  it("can clear the configured personality override", () => {
    expect(
      setEnvironmentPersonalityId(
        {
          default_context: {
            system_prompt: "Use concise answers",
            personality: "cold"
          }
        },
        null
      )
    ).toEqual({
      default_context: {
        system_prompt: "Use concise answers"
      }
    });
    expect(getEnvironmentPersonalityOverrideId({ default_context: { personality: "cold" } })).toBe("cold");
  });
});

describe("task cleanup payload helpers", () => {
  it("reads expiration days from payload", () => {
    expect(
      getTaskCleanupExpirationDays({
        task_cleanup: {
          expiration_days: 14
        }
      })
    ).toBe(14);

    expect(
      getTaskCleanupExpirationDays({
        task_cleanup: {
          expiration_days: "9"
        }
      })
    ).toBe(9);
  });

  it("updates payload with cleanup expiration settings", () => {
    const withExpiration = setTaskCleanupExpirationDays(
      {
        responses: {
          store: false
        }
      },
      21
    );
    expect(withExpiration).toEqual({
      responses: {
        store: false
      },
      task_cleanup: {
        expiration_days: 21
      }
    });

    const withoutExpiration = setTaskCleanupExpirationDays(withExpiration, null);
    expect(withoutExpiration).toEqual({
      responses: {
        store: false
      }
    });
  });
});

describe("network request debug helpers", () => {
  it("reads network logging flag from debug payload", () => {
    expect(
      getNetworkRequestLoggingEnabled({
        debug: {
          log_network_requests: true
        }
      })
    ).toBe(true);
    expect(getNetworkRequestLoggingEnabled({})).toBe(false);
  });

  it("sets and unsets network logging while preserving debug object", () => {
    const enabled = setNetworkRequestLoggingEnabled(
      {
        responses: {
          store: false
        }
      },
      true
    );
    expect(enabled).toEqual({
      responses: {
        store: false
      },
      debug: {
        log_network_requests: true
      }
    });

    const disabled = setNetworkRequestLoggingEnabled(enabled, false);
    expect(disabled).toEqual({
      responses: {
        store: false
      }
    });
  });
});

describe("sandbox network helpers", () => {
  it("defaults sandbox networking to enabled", () => {
    expect(getSandboxNetworkEnabled({})).toBe(true);
  });

  it("sets and unsets sandbox network flag while preserving other sandbox keys", () => {
    const disabled = setSandboxNetworkEnabled(
      {
        sandbox: {
          mode: "default"
        }
      },
      false
    );
    expect(disabled).toEqual({
      sandbox: {
        mode: "default",
        network_enabled: false
      }
    });

    const enabled = setSandboxNetworkEnabled(disabled, true);
    expect(enabled).toEqual({
      sandbox: {
        mode: "default"
      }
    });
  });

  it("supports nullable explicit overrides for inheritance-aware forms", () => {
    const allowed = setSandboxNetworkEnabledOverride({}, true);
    expect(allowed).toEqual({
      sandbox: {
        network_enabled: true
      }
    });
    expect(getSandboxNetworkEnabledOverride(allowed)).toBe(true);
    expect(setSandboxNetworkEnabledOverride(allowed, null)).toEqual({});
  });
});

describe("file download URL helpers", () => {
  it("builds single download URL with path", () => {
    expect(buildDownloadUrl("env-1", "docs/readme.md")).toBe(
      "http://localhost:4000/api/projects/env-1/files/download?path=docs%2Freadme.md"
    );
  });

  it("builds batch download URL with repeated path params", () => {
    expect(buildBatchDownloadUrl("env-1", ["a.txt", "dir/data.json"])).toBe(
      "http://localhost:4000/api/projects/env-1/files/download/batch?path=a.txt&path=dir%2Fdata.json"
    );
  });

  it("includes the current viewed directory for batch downloads", () => {
    expect(buildBatchDownloadUrl("env-1", ["dir/data.json"], ".meowbert/task-runs/run-1/specs")).toBe(
      "http://localhost:4000/api/projects/env-1/files/download/batch?path=dir%2Fdata.json&cwd=.meowbert%2Ftask-runs%2Frun-1%2Fspecs"
    );
  });

  it("includes the current viewed directory for workspace batch downloads", () => {
    expect(buildWorkspaceBatchDownloadUrl("ws-1", ["dir/data.json"], "notes/specs")).toBe(
      "http://localhost:4000/api/workspaces/ws-1/files/download/batch?path=dir%2Fdata.json&cwd=notes%2Fspecs"
    );
  });
});
