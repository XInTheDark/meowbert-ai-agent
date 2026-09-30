import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  browseSourceFolder,
  downloadSourceFileToPath,
  searchSourceFiles
} from "../shared/source-proxy-client.mjs";

const server = new McpServer({
  name: "rclone-source",
  version: "1.0.0"
});

server.tool(
  "search_rclone",
  "Search the configured rclone remote by name or path. Omit folder_id to search from the configured base directory.",
  {
    query: z.string().min(1).describe("Search query."),
    folder_id: z.string().min(1).nullable().optional().describe("Folder path relative to the configured base directory. Leave empty for the base directory."),
    limit: z.number().int().min(1).max(200).nullable().optional().describe("Maximum number of results.")
  },
  async ({ query, folder_id, limit }) => searchSourceFiles({ query, folderId: folder_id ?? null, limit: limit ?? undefined })
);

server.tool(
  "list_rclone_folder",
  "Browse a folder in the configured rclone remote. Omit folder_id to browse the configured base directory.",
  {
    folder_id: z.string().min(1).nullable().optional().describe("Folder path relative to the configured base directory. Leave empty for the base directory."),
    limit: z.number().int().min(1).max(400).nullable().optional().describe("Maximum number of children to return.")
  },
  async ({ folder_id, limit }) => browseSourceFolder({ folderId: folder_id ?? null, limit: limit ?? undefined })
);

server.tool(
  "fetch_rclone_file",
  "Download an rclone remote file to the specified path inside the task or workspace filesystem.",
  {
    item_id: z.string().min(1).describe("File path relative to the configured base directory."),
    output_path: z.string().min(1).describe("Destination path. Relative paths resolve from the task directory.")
  },
  async ({ item_id, output_path }) => downloadSourceFileToPath({ itemId: item_id, outputPath: output_path })
);

const transport = new StdioServerTransport();
await server.connect(transport);
