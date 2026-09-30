import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export async function startInstructionSkillServer(options) {
  const server = new McpServer({
    name: options.name,
    version: options.version ?? "1.0.0"
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
