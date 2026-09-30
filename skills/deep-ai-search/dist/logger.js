const levelRank = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};
function formatExtra(extra) {
    if (extra === undefined)
        return '';
    try {
        if (typeof extra === 'string')
            return ` ${extra}`;
        return ` ${JSON.stringify(extra)}`;
    }
    catch {
        return ' [unserializable extra]';
    }
}
export function createLogger(level) {
    const current = levelRank[level];
    function log(at, msg, extra) {
        if (levelRank[at] < current)
            return;
        // MCP servers should log to stderr, never stdout (stdout is the protocol transport).
        console.error(`[${at}] ${msg}${formatExtra(extra)}`);
    }
    return {
        debug: (msg, extra) => log('debug', msg, extra),
        info: (msg, extra) => log('info', msg, extra),
        warn: (msg, extra) => log('warn', msg, extra),
        error: (msg, extra) => log('error', msg, extra)
    };
}
//# sourceMappingURL=logger.js.map