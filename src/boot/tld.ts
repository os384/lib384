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
const singleTLDs = new Set([
    'localhost',
    'io', 'dev', 'app', 'land', 'ac', 'lk', 'cc',
    'com', 'net', 'org', 'jp', 'de', 'fr', 'br', 'it', 'ru', 'es', 'me', 'gov',
    'pl', 'ca', 'in', 'nl', 'edu', 'eu', 'ch', 'id', 'at', 'kr', 'cz', 'mx',
    'be', 'se', 'tr', 'tw', 'al', 'ua', 'ir', 'vn', 'cl', 'sk', 'to', 'no',
    'fi', 'us', 'pt', 'dk', 'ar', 'hu', 'tk', 'gr', 'il', 'sg', 'ru',
]);

const tldsWithSLDs = {
    'uk': ['co', 'ac', 'gov', 'org', 'net'],
    'au': ['com', 'net', 'org', 'edu', 'gov'],
    'nz': ['co', 'org', 'net', 'edu', 'gov', 'ac', 'gen', 'kiwi', 'maori'],
    'br': ['com', 'net', 'org', 'gov', 'edu', 'mil'],
    'jp': ['co', 'ac', 'go', 'or', 'ne'],
    'kr': ['co', 'go', 'ne', 'or', 're'],
    'ar': ['com', 'net', 'org', 'gov', 'edu', 'mil'],
    'il': ['co', 'ac', 'org', 'net', 'gov'],
    'sg': ['com', 'net', 'org', 'gov', 'edu', 'per'],
};

const ipv4Regex = /^\d{1,3}(\.\d{1,3}){3}$/;

/** @internal */
export function getDomainDetails(hostname: string = globalThis.location?.hostname ?? null) {
    const errorResult = { baseDomain: null, subdomain: null, port: null };

    if (!hostname) { console.warn("[getDomainDetails] cannot read location"); return errorResult; }
    const parts = hostname.split('.').reverse();
    if (parts.length === 0) { console.warn("[getDomainDetails] cannot parse location"); return errorResult; }
    const topLevel = parts[0];
    const port = globalThis.location?.port ?? null;
    if (parts.length === 1) {
        if (topLevel === 'localhost') {
            return { baseDomain: hostname, subdomain: null, port: port };
        } else {
            // for now, only localhost allowed as singleton (unless it's IPFS, below)
            console.warn("[getDomainDetails] singleton TLD not on allowed list");
            return errorResult;
        }
    }
    if (ipv4Regex.test(parts.slice(0, 4).reverse().join('.'))) {
        // we support ipv4 addresses, but not ipv6
        const baseDomain = parts.slice(0, 4).reverse().join('.');
        const subdomain = parts.length > 4 ? parts.slice(4).reverse().join('.') : null;
        return { baseDomain, subdomain, port: port ?? null };
    }
    let baseDomain = null;
    let subdomain = null;
    if (topLevel === 'localhost' && parts.length === 3 && parts[1] === 'ipfs') {
        // this is how Brave represents an IPFS address, eg it'll 
        // look like '<CID>.ipfs.localhost'
        return { baseDomain: parts[2], subdomain: null, port: port };
    } else if (topLevel === 'localhost') {
        baseDomain = parts.slice(0, 1).reverse().join('.');
        subdomain = parts.slice(1).reverse().join('.') || null;
    } else if (singleTLDs.has(topLevel)) {
        // we know length is at least 2
        baseDomain = parts.slice(0, 2).reverse().join('.');
        subdomain = parts.slice(2).reverse().join('.') || null;
    } else {
        if (parts.length < 3) { return { baseDomain: null, subdomain: null, port: port }; }
        const secondLevel = parts[1]
        const slds = tldsWithSLDs[topLevel as keyof typeof tldsWithSLDs];
        if (slds && slds.includes(secondLevel)) {
            baseDomain = parts.slice(0, 3).reverse().join('.')
            subdomain = parts.slice(3).reverse().join('.') || null;
        } else {
            return errorResult;
        }
    }
    return { baseDomain, subdomain, port: port };
}
