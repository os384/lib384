// (c) 2023 384 (tm)

// This is an separate module to facilitate code density

import { generatePassPhrase, generateStrongKey, recreateStrongKey } from './strongphrase';

/** @public */
export const strongphrase = {
    generate: generatePassPhrase,
    toKey: generateStrongKey,
    recreateKey: recreateStrongKey
};
