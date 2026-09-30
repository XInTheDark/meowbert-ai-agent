#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { initIoLog } from './io-log.js';
import { registerSearchTool } from './tools/search.js';
import { registerFetchTool } from './tools/fetch.js';
async function main() {
    const config = await loadConfig();
    const logger = createLogger(config.logLevel);
    initIoLog(config.logFile);
    const server = new McpServer({
        name: 'deep-ai-search-mcp',
        version: '0.1.0'
    });
    registerSearchTool(server, config, logger);
    registerFetchTool(server, config, logger);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('deep-ai-search-mcp running on stdio');
}
main().catch(err => {
    console.error('Fatal server error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map