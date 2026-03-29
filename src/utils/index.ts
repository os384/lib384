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
import {
    Base62Encoded,
    isBase62Encoded,
    arrayBufferToBase62,
    base62ToArrayBuffer,
} from './b62';

import {
    arrayBufferToBase64url,
    base64ToArrayBuffer,
} from './b64';

import {
    compareBuffers,
} from './buffers';

import {
    assemblePayload,
    extractPayload,
} from './payloads';

/**
 * Convenience: direct conversion from Base62 to Base64.
 * @public
 */
export function base62ToBase64(s: Base62Encoded): string {
    return arrayBufferToBase64url(base62ToArrayBuffer(s));
}

/**
 * Convenience: direct conversion from Base64 to Base62.
 * @public
 */
export function base64ToBase62(s: string): Base62Encoded {
    return arrayBufferToBase62(base64ToArrayBuffer(s));
}


/**
 * @public
 */
export const utils = {
    arrayBufferToBase62,
    arrayBufferToBase64url,
    assemblePayload,
    base62ToArrayBuffer,
    base62ToBase64,
    base64ToArrayBuffer,
    base64ToBase62,
    compareBuffers,
    extractPayload,
    isBase62Encoded,

    // generateRandomString,

    // _check_ObjectHandle,
    // stringify_ObjectHandle,
    // validate_ObjectHandle,

    // _check_SBChannelData,
    // validate_SBChannelData,

    // validate_Message,
};
