import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  browseSourceFolder,
  downloadSourceFileToPath,
  searchSourceFiles
} from "../shared/source-proxy-client.mjs";

const server = new McpServer({
  name: "google-drive-source",
  version: "1.0.0"
});

server.tool(
  "search_google_drive",
  "Search Google Drive files in a folder available to the connected workspace account, or paste a Google Drive/Docs/Sheets/Slides URL to resolve that exact item. Omit folder_id to search the root folder.",
  {
    query: z.string().min(1).describe("Search query or Google Drive/Docs/Sheets/Slides URL."),
    folder_id: z.string().min(1).nullable().optional().describe("Folder ID to search. Leave empty for the root."),
    limit: z.number().int().min(1).max(200).nullable().optional().describe("Maximum number of results.")
  },
  async ({ query, folder_id, limit }) => searchSourceFiles({ query, folderId: folder_id ?? null, limit: limit ?? undefined })
);

server.tool(
  "list_google_drive_folder",
  "Browse a Google Drive folder. Omit folder_id to browse the root folder.",
  {
    folder_id: z.string().min(1).nullable().optional().describe("Folder ID to browse. Leave empty for the root."),
    limit: z.number().int().min(1).max(400).nullable().optional().describe("Maximum number of children to return.")
  },
  async ({ folder_id, limit }) => browseSourceFolder({ folderId: folder_id ?? null, limit: limit ?? undefined })
);

server.tool(
  "fetch_google_drive_file",
  "Download a Google Drive file to the specified path inside the task or workspace filesystem.",
  {
    item_id: z.string().min(1).describe("Google Drive file ID."),
    output_path: z.string().min(1).describe("Destination path. Relative paths resolve from the task directory.")
  },
  async ({ item_id, output_path }) => downloadSourceFileToPath({ itemId: item_id, outputPath: output_path })
);

const transport = new StdioServerTransport();
await server.connect(transport);
