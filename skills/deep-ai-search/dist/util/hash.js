import { createHash } from 'node:crypto';
export function sha256Base64Url(input) {
    const h = createHash('sha256').update(input).digest('base64url');
    return h;
}
//# sourceMappingURL=hash.js.map