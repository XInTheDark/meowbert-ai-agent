export type DownloadedFileMetadata = {
    sourceUrl: string;
    fetchedUrl: string;
    contentType?: string;
    contentDisposition?: string;
    bytes: Uint8Array;
};
type FileConversionErrorKind = 'missing_markitdown' | 'missing_dependency' | 'unsupported_format' | 'conversion_failed';
export declare class FileConversionError extends Error {
    readonly kind: FileConversionErrorKind;
    constructor(kind: FileConversionErrorKind, message: string);
}
export declare function convertDownloadedFileToMarkdown(metadata: DownloadedFileMetadata): Promise<string>;
export declare function sniffTextDownload(bytes: Uint8Array, contentType?: string): string | undefined;
export declare function looksLikeHtmlDocument(text: string): boolean;
export {};
