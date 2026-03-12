// (c) 2023 384 (tm)

import { loadShard, bootstrapJsLib } from './loadShard';
import { bootstrapLoaderClass } from './loaderLoader';
import { getDomainDetails } from './tld';
import { SBServiceWorker } from './serviceWorker';

/**
 * Bootstrapping functions for the 384 library.
 * @internal
 */
export const boot = {
    loadShard: loadShard,
    bootstrapJsLib: bootstrapJsLib,
    boostrapLoaderClass: bootstrapLoaderClass,
    getDomainDetails: getDomainDetails,
    serviceWorker: SBServiceWorker
};
