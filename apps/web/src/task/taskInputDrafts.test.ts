import { describe, expect, it } from "vitest";
import { buildDefaultTaskParameters } from "./taskParameters";
import {
  buildDefaultTaskToolOptions,
  getTaskInputDraftForEnvironment,
  normalizeToolOptions,
  normalizeTaskInputDraft,
  shouldRotateRestoredComposerTaskId,
  updateTaskInputDraftForEnvironment
} from "./taskInputDrafts";

describe("normalizeTaskInputDraft", () => {
  it("defaults missing agent id to null", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {
        webSearch: true,
        scheduleTask: false,
        subtasks: false,
        enabledSkills: []
      }
    });

    expect(normalized.agentId).toBeNull();
    expect(normalized.attachments).toEqual([]);
    expect(normalized.composerTaskId).toBeNull();
    expect(normalized.quickMode).toBe(false);
  });

  it("persists Quick mode only when explicitly enabled", () => {
    expect(normalizeTaskInputDraft({ prompt: "hello", quickMode: true }).quickMode).toBe(true);
    expect(normalizeTaskInputDraft({ prompt: "hello", quickMode: "true" }).quickMode).toBe(false);
  });

  it("normalizes and lowercases agent id", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      agentId: " FAST "
    });

    expect(normalized.agentId).toBe("fast");
  });

  it("uses Memory defaults when tool options are missing", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello"
    }, { memorySearch: true });

    expect(normalized.toolOptions).toEqual({
      ...buildDefaultTaskToolOptions({ memorySearch: true })
    });
    expect(normalized.taskParameters).toEqual(buildDefaultTaskParameters());
  });

  it("uses workspace toolset defaults for new or partial drafts while Memory stays separate", () => {
    const defaults = {
      memorySearch: true,
      defaultToolset: {
        webSearch: true,
        memorySearch: false,
        scheduleTask: true,
        subtasks: false,
        computerUse: false,
        interactiveCanvas: false,
        enabledSkills: ["html-canvas"],
        enabledSources: []
      }
    };

    expect(buildDefaultTaskToolOptions(defaults)).toEqual({
      webSearch: true,
      memorySearch: true,
      scheduleTask: true,
      subtasks: false,
      computerUse: false,
      interactiveCanvas: false,
      enabledSkills: ["html-canvas"],
      enabledSources: []
    });
    expect(normalizeToolOptions({ memorySearch: false }, defaults)).toEqual({
      webSearch: true,
      memorySearch: false,
      scheduleTask: true,
      subtasks: false,
      computerUse: false,
      interactiveCanvas: false,
      enabledSkills: ["html-canvas"],
      enabledSources: []
    });
  });

  it("does not normalize Interactive Canvas into the legacy Canvas skill", () => {
    const defaults = {
      defaultToolset: {
        webSearch: true,
        memorySearch: false,
        scheduleTask: true,
        subtasks: false,
        computerUse: false,
        interactiveCanvas: false,
        enabledSkills: ["html-canvas"],
        enabledSources: []
      }
    };

    expect(normalizeToolOptions({
      interactiveCanvas: true,
      enabledSkills: ["html-canvas", "deep-ai-search"]
    }, defaults)).toEqual({
      webSearch: true,
      memorySearch: false,
      scheduleTask: true,
      subtasks: false,
      computerUse: false,
      interactiveCanvas: true,
      enabledSkills: ["deep-ai-search"],
      enabledSources: []
    });
  });

  it("defaults missing task parameters", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {}
    });

    expect(normalized.taskParameters).toEqual(buildDefaultTaskParameters());
  });

  it("normalizes stored attachments and composer task id", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      attachments: [
        {
          id: "file-1",
          kind: "file",
          label: "report.pdf",
          content: "inputs/report.pdf",
          relativePath: "inputs/report.pdf",
          sizeBytes: 42,
          forceInclude: true
        },
        {
          kind: "note",
          label: "Video metadata",
          content: "https://example.com/watch?v=123",
          sizeBytes: null
        },
        {
          kind: "canvas",
          label: "Quadratics Lab",
          content: "Canvas: Quadratics Lab",
          relativePath: "canvases/quadratics-lab"
        },
        {
          kind: "wat",
          label: "bad",
          content: "bad"
        }
      ],
      composerTaskId: " task-123 ",
      toolOptions: {}
    });

    expect(normalized.attachments).toEqual([
      {
        id: "file-1",
        kind: "file",
        label: "report.pdf",
        content: "inputs/report.pdf",
        relativePath: "inputs/report.pdf",
        sizeBytes: 42,
        forceInclude: true
      },
      {
        id: expect.any(String),
        kind: "note",
        label: "Video metadata",
        content: "https://example.com/watch?v=123",
        sizeBytes: null
      },
      {
        id: expect.any(String),
        kind: "canvas",
        label: "Quadratics Lab",
        content: "Canvas: Quadratics Lab",
        relativePath: "canvases/quadratics-lab"
      }
    ]);
    expect(normalized.composerTaskId).toBe("task-123");
  });

  it("preserves disabled waiting in stored task parameters", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      taskParameters: {
        allowWaiting: false
      }
    });

    expect(normalized.taskParameters.allowWaiting).toBe(false);
  });

  it("normalizes the Long Horizon token budget", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      workflow: {
        type: "long_horizon",
        workerCount: 3,
        modelAllocations: [],
        tokenBudget: 125_500.9
      }
    });

    expect(normalized.workflow).toEqual({
      type: "long_horizon",
      workerCount: 3,
      reviewRounds: 0,
      leaderAgentId: null,
      modelAllocations: [],
      tokenBudget: 125_500,
      timeBudgetMinutes: null,
      enableClarifyPhase: true,
      enableReviewPhase: true
    });
  });

  it("defaults the workflow token and time budget to null", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      workflow: {
        type: "long_horizon",
        workerCount: 3,
        modelAllocations: []
      }
    });

    expect(normalized.workflow.tokenBudget).toBeNull();
    expect(normalized.workflow.timeBudgetMinutes).toBeNull();
  });

  it("preserves timeBudgetMinutes and phase toggles in Long Horizon draft", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      workflow: {
        type: "long_horizon",
        workerCount: 3,
        modelAllocations: [],
        tokenBudget: 50_000,
        timeBudgetMinutes: 45.8,
        enableClarifyPhase: false,
        enableReviewPhase: false
      }
    });

    expect(normalized.workflow).toEqual({
      type: "long_horizon",
      workerCount: 3,
      reviewRounds: 0,
      leaderAgentId: null,
      modelAllocations: [],
      tokenBudget: 50_000,
      timeBudgetMinutes: 45,
      enableClarifyPhase: false,
      enableReviewPhase: false
    });
  });

  it("preserves Quality control as a Long Horizon composer variant", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      workflow: {
        type: "quality_control",
        workerCount: 3,
        modelAllocations: [],
        tokenBudget: 80_500.9
      }
    });

    expect(normalized.workflow).toEqual({
      type: "quality_control",
      workerCount: 3,
      reviewRounds: 0,
      leaderAgentId: null,
      modelAllocations: [],
      tokenBudget: 80_500,
      timeBudgetMinutes: null,
      enableClarifyPhase: true,
      enableReviewPhase: true
    });
  });

  it("preserves Deep Research as a Long Horizon composer variant", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      workflow: {
        type: "deep_research",
        workerCount: 3,
        modelAllocations: [],
        tokenBudget: 80_500.9
      }
    });

    expect(normalized.workflow).toEqual({
      type: "deep_research",
      workerCount: 3,
      reviewRounds: 0,
      leaderAgentId: null,
      modelAllocations: [],
      tokenBudget: 80_500,
      timeBudgetMinutes: null,
      enableClarifyPhase: true,
      enableReviewPhase: true
    });
  });

  it("derives Agent Swarm worker count from valid model allocations", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      workflow: {
        type: "agent_swarm",
        workerCount: 2,
        reviewRounds: 2,
        modelAllocations: [
          { agentId: "Fast", workerCount: 2 },
          { agentId: "Deep", workerCount: 3 }
        ]
      }
    });

    expect(normalized.workflow).toEqual({
      type: "agent_swarm",
      workerCount: 5,
      reviewRounds: 2,
      leaderAgentId: null,
      modelAllocations: [
        { agentId: "fast", workerCount: 2 },
        { agentId: "deep", workerCount: 3 }
      ],
      tokenBudget: null,
      timeBudgetMinutes: null,
      disableSpawningAndBudgets: false,
      enableClarifyPhase: true,
      enableReviewPhase: true
    });
  });

  it("persists Agent Swarm token and time budgets in the composer draft", () => {
    const normalized = normalizeTaskInputDraft({
      prompt: "hello",
      toolOptions: {},
      workflow: {
        type: "agent_swarm",
        workerCount: 3,
        modelAllocations: [{ agentId: "fast", workerCount: 3 }],
        tokenBudget: 125_500.9,
        timeBudgetMinutes: 45.8
      }
    });

    expect(normalized.workflow.tokenBudget).toBe(125_500);
    expect(normalized.workflow.timeBudgetMinutes).toBe(45);
  });

  it("normalizes and deduplicates enabled source ids", () => {
    const normalized = normalizeToolOptions({
      enabledSkills: [" skill-a ", "skill-a", "", 123],
      enabledSources: [" google-drive ", "google-drive", "onedrive", null]
    });

    expect(normalized.enabledSkills).toEqual(["skill-a"]);
    expect(normalized.enabledSources).toEqual(["google-drive", "onedrive"]);
  });
});

describe("shouldRotateRestoredComposerTaskId", () => {
  it("rotates a restored draft id when no attachments depend on its upload path", () => {
    const draft = normalizeTaskInputDraft({
      prompt: "new prompt",
      attachments: [],
      composerTaskId: "326522d1-67cc-4475-92ce-a85b18556261",
      toolOptions: {}
    });

    expect(shouldRotateRestoredComposerTaskId(draft)).toBe(true);
  });

  it("keeps a restored draft id when attachments still point at its upload path", () => {
    const draft = normalizeTaskInputDraft({
      prompt: "new prompt",
      attachments: [
        {
          id: "file-1",
          kind: "file",
          label: "report.pdf",
          content: ".meowbert/task-runs/326522d1-67cc-4475-92ce-a85b18556261/inputs/report.pdf"
        }
      ],
      composerTaskId: "326522d1-67cc-4475-92ce-a85b18556261",
      toolOptions: {}
    });

    expect(shouldRotateRestoredComposerTaskId(draft)).toBe(false);
  });

  it("does not rotate a draft that does not have a restored id", () => {
    expect(shouldRotateRestoredComposerTaskId(normalizeTaskInputDraft({ prompt: "hello" }))).toBe(false);
  });
});

describe("per-project draft defaults", () => {
  it("defaults Memory to on for environments with Memory enabled", () => {
    const draft = getTaskInputDraftForEnvironment({}, "env-1", { memorySearch: true });

    expect(draft.toolOptions.memorySearch).toBe(true);
  });

  it("preserves Memory default when creating the first draft entry", () => {
    const updated = updateTaskInputDraftForEnvironment(
      {},
      "env-1",
      (current) => ({
        ...current,
        prompt: "remember this"
      }),
      { memorySearch: true }
    );

    expect(updated["env-1"]?.toolOptions.memorySearch).toBe(true);
  });
});
