import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const PYTHON_EXEC_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const MISSING_MODULE_PACKAGE_NAMES = new Map([
    ['pptx', 'python-pptx'],
    ['docx', 'python-docx'],
    ['mammoth', 'mammoth'],
    ['lxml', 'lxml'],
    ['pandas', 'pandas'],
    ['openpyxl', 'openpyxl'],
    ['xlrd', 'xlrd'],
    ['pdfplumber', 'pdfplumber'],
    ['pdfminer', 'pdfminer.six'],
    ['olefile', 'olefile']
]);
const TEXT_LIKE_CONTENT_TYPE_SNIPPETS = [
    'json',
    'xml',
    'yaml',
    'yml',
    'javascript',
    'ecmascript',
    'csv',
    'tsv',
    'markdown'
];
export class FileConversionError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.name = 'FileConversionError';
        this.kind = kind;
    }
}
export async function convertDownloadedFileToMarkdown(metadata) {
    const fileName = resolveDownloadFileName(metadata);
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'deep-ai-search-mcp-'));
    try {
        const filePath = path.join(tmpDir, fileName);
        await writeFile(filePath, metadata.bytes);
        const result = await runPythonProcess(['-m', 'markitdown', filePath]);
        if (result.code === 0 && result.stdout.trim()) {
            return result.stdout;
        }
        throw buildMarkItDownError(result, metadata, fileName);
    }
    finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    }
}
export function sniffTextDownload(bytes, contentType) {
    const mimeType = getMimeType(contentType);
    if (mimeType.startsWith('text/') || TEXT_LIKE_CONTENT_TYPE_SNIPPETS.some(snippet => mimeType.includes(snippet))) {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    const sample = bytes.slice(0, 4096);
    if (sample.some(byte => byte === 0)) {
        return undefined;
    }
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(sample);
    if (!decoded.trim()) {
        return undefined;
    }
    let printableChars = 0;
    for (const char of decoded) {
        const codePoint = char.codePointAt(0) ?? 0;
        if (char === '\n' || char === '\r' || char === '\t' || (codePoint >= 0x20 && codePoint !== 0xfffd)) {
            printableChars += 1;
        }
    }
    const printableRatio = printableChars / decoded.length;
    if (printableRatio < 0.9) {
        return undefined;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
export function looksLikeHtmlDocument(text) {
    const sample = text.slice(0, 2048).toLowerCase();
    return (sample.includes('<!doctype html') ||
        sample.includes('<html') ||
        sample.includes('<body') ||
        sample.includes('<head') ||
        sample.includes('<meta '));
}
function getMimeType(contentType) {
    return (contentType ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
}
function resolveDownloadFileName(metadata) {
    const explicitName = parseFilenameFromContentDisposition(metadata.contentDisposition) ??
        parseFilenameFromUrl(metadata.fetchedUrl) ??
        parseFilenameFromUrl(metadata.sourceUrl);
    let fileName = sanitizeFileName(explicitName ?? 'download');
    if (!path.extname(fileName)) {
        const guessedExtension = guessFileExtension(metadata.contentType);
        if (guessedExtension) {
            fileName += guessedExtension;
        }
    }
    return fileName;
}
function parseFilenameFromContentDisposition(contentDisposition) {
    if (!contentDisposition) {
        return undefined;
    }
    const starMatch = contentDisposition.match(/filename\*\s*=\s*([^;]+)/i);
    if (starMatch?.[1]) {
        const value = starMatch[1].trim().replace(/^"(.*)"$/, '$1');
        const parts = value.split("'");
        const encoded = parts.length >= 3 ? parts.slice(2).join("'") : value;
        return safeDecodeURIComponent(encoded);
    }
    const plainMatch = contentDisposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
    const raw = plainMatch?.[1] ?? plainMatch?.[2];
    return raw?.trim();
}
function parseFilenameFromUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        const lastSegment = url.pathname.split('/').pop();
        if (!lastSegment) {
            return undefined;
        }
        return safeDecodeURIComponent(lastSegment);
    }
    catch {
        return undefined;
    }
}
function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
function sanitizeFileName(value) {
    const normalized = value.replace(/\\/g, '/');
    const baseName = path.posix.basename(normalized).trim();
    const sanitized = baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    return sanitized || 'download';
}
function guessFileExtension(contentType) {
    const mimeType = getMimeType(contentType);
    if (!mimeType)
        return '';
    if (mimeType.includes('pdf'))
        return '.pdf';
    if (mimeType.includes('msword'))
        return '.doc';
    if (mimeType.includes('officedocument.wordprocessingml'))
        return '.docx';
    if (mimeType.includes('vnd.ms-powerpoint'))
        return '.ppt';
    if (mimeType.includes('officedocument.presentationml'))
        return '.pptx';
    if (mimeType.includes('vnd.ms-excel'))
        return '.xls';
    if (mimeType.includes('officedocument.spreadsheetml'))
        return '.xlsx';
    if (mimeType.includes('csv'))
        return '.csv';
    if (mimeType.includes('tab-separated-values'))
        return '.tsv';
    if (mimeType.includes('markdown'))
        return '.md';
    if (mimeType.includes('plain'))
        return '.txt';
    if (mimeType.includes('json'))
        return '.json';
    if (mimeType.includes('xml'))
        return '.xml';
    if (mimeType.includes('epub'))
        return '.epub';
    if (mimeType.includes('rtf'))
        return '.rtf';
    if (mimeType.includes('rfc822'))
        return '.eml';
    if (mimeType.includes('vnd.ms-outlook'))
        return '.msg';
    if (mimeType.includes('zip'))
        return '.zip';
    return '';
}
function buildMarkItDownError(result, metadata, fileName) {
    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    const excerpt = combinedOutput.slice(0, 1200) || 'unknown error';
    const descriptor = describeDownload(metadata, fileName);
    if (/No module named ['"]markitdown['"]/.test(combinedOutput)) {
        return new FileConversionError('missing_markitdown', `The bundled runtime image is missing the \`markitdown\` package required to convert downloaded files (${descriptor}). Underlying error: ${excerpt}`);
    }
    const missingModule = getMissingModuleName(combinedOutput);
    if (missingModule) {
        const packageName = MISSING_MODULE_PACKAGE_NAMES.get(missingModule) ?? missingModule;
        return new FileConversionError('missing_dependency', `The bundled runtime image is missing the MarkItDown optional dependency \`${packageName}\` required for this file type (${descriptor}). Underlying error: ${excerpt}`);
    }
    if (looksLikeUnsupportedFormatError(combinedOutput)) {
        return new FileConversionError('unsupported_format', `MarkItDown does not support this downloaded file type or could not determine its format (${descriptor}). Underlying error: ${excerpt}`);
    }
    return new FileConversionError('conversion_failed', `MarkItDown failed to convert the downloaded file (${descriptor}, exitCode=${result.code ?? 'unknown'}). Underlying error: ${excerpt}`);
}
function describeDownload(metadata, fileName) {
    const mimeType = getMimeType(metadata.contentType) || 'unknown';
    return `file=${fileName}, contentType=${mimeType}, url=${metadata.fetchedUrl}`;
}
function getMissingModuleName(output) {
    const match = output.match(/No module named ['"]([^'"]+)['"]/);
    if (!match?.[1] || match[1] === 'markitdown') {
        return undefined;
    }
    return match[1];
}
function looksLikeUnsupportedFormatError(output) {
    const normalized = output.toLowerCase();
    return (normalized.includes('unsupported format') ||
        normalized.includes('unsupportedformat') ||
        normalized.includes('file format not supported') ||
        normalized.includes('could not determine the file format') ||
        normalized.includes('cannot determine the file format') ||
        normalized.includes('no suitable converter') ||
        normalized.includes('converter not found'));
}
async function runPythonProcess(args) {
    return await new Promise(resolve => {
        execFile('python3', args, { encoding: 'utf8', maxBuffer: PYTHON_EXEC_MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
            if (error) {
                resolve({ stdout: stdout ?? '', stderr: stderr ?? String(error), code: error.code ?? 1 });
                return;
            }
            resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: 0 });
        });
    });
}
//# sourceMappingURL=file-conversion.js.map