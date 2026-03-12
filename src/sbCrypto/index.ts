// (c) 2023 384 (tm)

// some older code create their own instances
export { SBCrypto } from './SBCrypto';

import { SBCrypto } from './SBCrypto';

/**
 * This is the global SBCrypto object, which is instantiated
 * immediately upon loading the library.
 * 
 * You should use this and not instantiate your own. We don't
 * use static functions in SBCrypto(), because we want to be
 * able to add features (like global key store) incrementally.
 * 
 * @public
 */
export const sbCrypto = new SBCrypto();
