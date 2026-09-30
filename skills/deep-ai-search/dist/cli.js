#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import * as z from 'zod/v4';
import { loadConfig } from './config.js';
import { initIoLog } from './io-log.js';
import { createLogger } from './logger.js';
import { createFetchToolHandler, getFetchToolInputSchema } from './tools/fetch.js';
import { createSearchToolHandler, getSearchToolInputSchema } from './tools/search.js';
function usage() {
    return [
        'Usage:',
        '  deep-ai-search-cli <search|fetch> [--input <json> | --input-file <path> | <json>]',
        '  deep-ai-search-cli <search|fetch> < input.json',
        '',
        'Examples:',
        `  deep-ai-search-cli search --input '{"query":"latest bun release notes","breadth":6}'`,
        `  deep-ai-search-cli fetch --input '{"url":"https://example.com","depth":5}'`,
        '  cat input.json | deep-ai-search-cli search',
        '',
        'Options:',
        '  --input <json>       JSON payload for the selected tool call',
        '  --input-file <path>  Read JSON payload from a file',
        '  --compact            Print compact JSON instead of pretty output',
        '  -h, --help           Show this help message'
    ].join('\n');
}
function parseArgs(argv) {
    if (argv.length === 0) {
        throw new Error(`Missing command.\n\n${usage()}`);
    }
    if (argv.length === 1 && (argv[0] === '-h' || argv[0] === '--help')) {
        return {
            command: 'search',
            help: true,
            pretty: true
        };
    }
    const [rawCommand, ...rest] = argv;
    if (rawCommand !== 'search' && rawCommand !== 'fetch') {
        throw new Error(`Unknown command: ${rawCommand}\n\n${usage()}`);
    }
    const parsed = {
        command: rawCommand,
        help: false,
        pretty: true
    };
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (arg === '-h' || arg === '--help') {
            parsed.help = true;
            continue;
        }
        if (arg === '--compact') {
            parsed.pretty = false;
            continue;
        }
        if (arg === '--input') {
            const value = rest[i + 1];
            if (!value) {
                throw new Error('Missing value after --input');
            }
            parsed.inputArg = value;
            i += 1;
            continue;
        }
        if (arg === '--input-file') {
            const value = rest[i + 1];
            if (!value) {
                throw new Error('Missing value after --input-file');
            }
            parsed.inputFile = value;
            i += 1;
            continue;
        }
        if (arg.startsWith('--')) {
            throw new Error(`Unknown option: ${arg}`);
        }
        if (parsed.inputArg !== undefined) {
            throw new Error('Multiple JSON inputs provided. Pass only one payload source.');
        }
        parsed.inputArg = arg;
    }
    if (parsed.inputArg && parsed.inputFile) {
        throw new Error('Use only one of --input, --input-file, positional JSON, or stdin.');
    }
    return parsed;
}
async function readStdin() {
    return await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => {
            data += chunk;
        });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
    });
}
async function readInputPayload(args) {
    if (args.inputArg !== undefined) {
        return JSON.parse(args.inputArg);
    }
    if (args.inputFile) {
        const raw = await readFile(args.inputFile, 'utf8');
        return JSON.parse(raw);
    }
    if (!process.stdin.isTTY) {
        const raw = (await readStdin()).trim();
        if (!raw) {
            throw new Error('Stdin is empty; expected a JSON payload.');
        }
        return JSON.parse(raw);
    }
    throw new Error(`Missing JSON payload.\n\n${usage()}`);
}
function printJson(value, pretty) {
    const output = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    process.stdout.write(`${output}\n`);
}
async function run() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const payload = await readInputPayload(args);
    const config = await loadConfig();
    const logger = createLogger(config.logLevel);
    initIoLog(config.logFile);
    if (args.command === 'search') {
        const inputSchema = z.object(getSearchToolInputSchema(config));
        const input = inputSchema.parse(payload);
        const handler = createSearchToolHandler(config, logger);
        const response = await handler(input);
        printJson(response, args.pretty);
        return;
    }
    const inputSchema = z.object(getFetchToolInputSchema(config));
    const input = inputSchema.parse(payload);
    const handler = createFetchToolHandler(config, logger);
    const response = await handler(input);
    printJson(response, args.pretty);
}
run().catch(err => {
    if (err instanceof z.ZodError) {
        process.stderr.write(`Invalid input:\n${JSON.stringify(err.issues, null, 2)}\n`);
        process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map