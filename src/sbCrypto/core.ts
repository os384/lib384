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
export async function importKey(format: KeyFormat, key: BufferSource | JsonWebKey, type: 'ECDH' | 'AES' | 'PBKDF2', extractable: boolean, keyUsages: KeyUsage[]) {
    try {
        let importedKey: CryptoKey
        const keyAlgorithms = {
            ECDH: { name: 'ECDH', namedCurve: 'P-384' },
            AES: { name: 'AES-GCM' },
            PBKDF2: 'PBKDF2'
        }
        if (format === 'jwk') {
            // sanity check it's a JsonWebKey and not a BufferSource or something else
            const jsonKey = key as JsonWebKey
            if (jsonKey.kty === undefined) throw new Error('importKey() - invalid JsonWebKey');
            if (jsonKey.alg === 'ECDH')
                jsonKey.alg = undefined; // todo: this seems to be a Deno mismatch w crypto standards?
            importedKey = await crypto.subtle.importKey('jwk', jsonKey, keyAlgorithms[type], extractable, keyUsages)
            // if (jsonKey.kty === 'EC')
            //   // public/private keys are cached
            //   this.addKnownKey(importedKey)
        } else {
            importedKey = await crypto.subtle.importKey(format, key as BufferSource, keyAlgorithms[type], extractable, keyUsages)
        }
        return (importedKey)
    } catch (e) {
        const msg = `... importKey() error: ${e}:`
        throw new Error(msg)
    }
}
