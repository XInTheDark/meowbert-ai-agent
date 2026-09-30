import { createHash } from 'node:crypto';

export function sha256Base64Url(input: string): string {
  const h = createHash('sha256').update(input).digest('base64url');
  return h;
}

