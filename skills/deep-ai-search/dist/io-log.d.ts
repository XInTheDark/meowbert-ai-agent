export declare function initIoLog(filePath: string | undefined): void;
export declare function writeIoLog(event: {
    type: string;
    [key: string]: unknown;
}): void;
export declare function sanitizeMcpContentForIoLog(content: unknown): unknown;
