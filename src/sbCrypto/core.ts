

/**
 * Import keys
 * @public
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
