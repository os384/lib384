/*
 * Copyright (C) 2019-2021 Magnusson Institute
 * Copyright (C) 2022-2026 384, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
/**
 * TL;DR on the 'base64 issue' (and it's a bit of a moving target):
 *
 * - btoa() and atob() are available in clients (browsers), but not in backends.
 *   In Node.js, they are not part of the core API and are flagged as deprecated
 *   in tooling like VSCode/TypeScript due to the '@deprecated' tag in type
 *   definitions. They are not available in Cloudflare Workers.
 *
 * - The 'Buffer' class is available in both Node.js and Cloudflare Workers but
 *   is not available in the browser. Deno, which is arguably 'backend',
 *   includes btoa() and atob(), but not Buffer.
 *
 * - Tooling like VSCode may default to Node typings and indicate that btoa/atob
 *   are 'deprecated' unless configured for a specific environment (e.g.,
 *   browser or Deno).
 *
 * Since we're not processing large amounts of base64 data (for which btoa() and
 * atob() are not well-suited anyway), we implement our own base64 encoding and
 * decoding functions for simplicity and consistent cross-environment
 * functionality. Our only real real need for this format is JWK, hence we only
 * implement the base64url variant. For our own use cases, we use base62.
 * 
 * @public
 */
export const base64url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const b64urlRegex = /^([A-Za-z0-9\-_]*)(={0,2})$/ // strict (ish)

/**
 * Converts an ArrayBuffer to base64url. 
 * @public
 */
export function arrayBufferToBase64url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
    result += base64url[b1 >> 2] +
      base64url[((b1 & 0x03) << 4) | (b2 >> 4)] +
      (b2 !== undefined ? base64url[((b2 & 0x0f) << 2) | (b3 >> 6)] : '') +
      (b3 !== undefined ? base64url[b3 & 0x3f] : '');
  }
  return result;
}

/**
 * Converts base64/base64url to ArrayBuffer. Despite it's name, returns a Uint8Array.
 * 
 * @public
 */
export function base64ToArrayBuffer(s: string): Uint8Array {
  s = s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (!b64urlRegex.test(s)) throw new Error(`invalid character in b64 string (after cleanup: '${s}')`)
  const len = s.length;
  const bytes = new Uint8Array(len * 3 / 4);
  for (let i = 0, p = 0; i < len; i += 4) {
    const [a, b, c, d] = [s[i], s[i + 1], s[i + 2], s[i + 3]].map(ch => base64url.indexOf(ch));
    bytes[p++] = (a << 2) | (b >> 4);
    if (c !== -1) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (d !== -1) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

