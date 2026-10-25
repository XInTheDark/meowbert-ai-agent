import type { FunctionTool } from "openai/resources/responses/responses";

export const HOST_SHELL_TOOL: FunctionTool = {
  type: "function", name: "host_shell", strict: true,
  description: "Run a command as the user on the computer running Meowbert Desktop. This has full access to the host, including outside the sandbox.",
  parameters: { type: "object", additionalProperties: false, properties: {
    command: { type: "string" },
    timeout_seconds: { type: ["number", "null"] }
  }, required: ["command", "timeout_seconds"] }
};
