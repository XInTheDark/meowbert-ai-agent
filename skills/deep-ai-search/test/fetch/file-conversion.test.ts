import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}));

import { convertDownloadedFileToMarkdown } from '../../src/fetch/file-conversion.js';

describe('file conversion', () => {
  afterEach(() => {
    execFileMock.mockReset();
  });

  it('uses the download filename from content-disposition metadata', async () => {
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
        callback(null, '# converted\n', '');
      }
    );

    const markdown = await convertDownloadedFileToMarkdown({
      sourceUrl: 'https://example.com/download?id=123',
      fetchedUrl: 'https://cdn.example.com/file',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentDisposition: "attachment; filename*=UTF-8''Quarterly%20Report.xlsx",
      bytes: new Uint8Array([1, 2, 3])
    });

    expect(markdown).toBe('# converted\n');
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const args = execFileMock.mock.calls[0]?.[1] as string[];
    expect(path.basename(args[2] ?? '')).toBe('Quarterly Report.xlsx');
  });

  it('surfaces missing MarkItDown optional dependencies clearly', async () => {
    execFileMock.mockImplementation(
      (_command: string, _args: string[], _options: unknown, callback: (error: Error & { code?: number }, stdout: string, stderr: string) => void) => {
        const error = Object.assign(new Error('python failed'), { code: 1 });
        callback(error, '', "Traceback\nModuleNotFoundError: No module named 'openpyxl'\n");
      }
    );

    await expect(
      convertDownloadedFileToMarkdown({
        sourceUrl: 'https://example.com/report.xlsx',
        fetchedUrl: 'https://example.com/report.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toMatchObject({
      kind: 'missing_dependency',
      message: expect.stringContaining('missing the MarkItDown optional dependency `openpyxl`')
    });
  });

  it('classifies unsupported file formats separately from missing dependencies', async () => {
    execFileMock.mockImplementation(
      (_command: string, _args: string[], _options: unknown, callback: (error: Error & { code?: number }, stdout: string, stderr: string) => void) => {
        const error = Object.assign(new Error('python failed'), { code: 1 });
        callback(error, '', 'UnsupportedFormatException: file format not supported');
      }
    );

    await expect(
      convertDownloadedFileToMarkdown({
        sourceUrl: 'https://example.com/archive.bin',
        fetchedUrl: 'https://example.com/archive.bin',
        contentType: 'application/octet-stream',
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toMatchObject({
      kind: 'unsupported_format',
      message: expect.stringContaining('does not support this downloaded file type')
    });
  });
});
