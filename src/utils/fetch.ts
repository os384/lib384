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
const DBG0 = false;

import { SBError } from 'src/utils/error'
import { extractPayload } from 'src/utils/payloads';
import { SEP } from 'src/utils/sep'
import { jsonParseWrapper } from 'src/utils/json';

declare var DBG2: boolean;

/**
 * sets default function to use for 'fetch'. ChannelApi() can change
 * this upon creation (globally) if another network operation is needed.
 * for example the channel server will override this internally
 * @pubic
 */
var sbFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) = SBFetch

export function setSBFetch(f: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    sbFetch = f
}
export function getSBFetch() {
    return sbFetch
}

// shared global set of fetches, sockets, etc, for closeAll()
const activeFetches = new Map<symbol, AbortController>()

export function abortActiveFetches() {
    activeFetches.forEach(controller => controller.abort('ChannelApi.closeAll() called'));
    activeFetches.clear();
}

/**
 * For various reasons, we wrap 'fetch()' - this function (SBFetch) should be
 * the ONLY place that directly calls browser/deno 'fetch()' operation.
 * 
 * Network operations have a special relationship with ChannelApi, for example,
 * it will keep track of all active fetches, and if the channel is shutting down
 * it will cancel all active fetches.
 * 
 * @internal
 */
export async function SBFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const id = Symbol('fetch');
    activeFetches.set(id, controller);
    try {
        const response = await fetch(input, { ...init, signal: controller.signal });
        if (DBG0) { console.log(SEP, "[SBFetch]", response, SEP); }
        // ToDo: kludge for now, to avoid pullin all sorts of code int service-worker
        // if (ChannelApi.isShutdown) { // your global shutdown flag
        //     await response.body?.cancel('shutDown')
        //     throw new SBError('Fetch aborted (shutDown)');
        // }
        return response;
    } catch (error: any) {
        if (error instanceof SBError) throw error
        // we try to harden slightly to handle a few recurring (long-run) issues;
        // some that have been reported for a long time with Deno
        const errStr = `${error}`
        if (
            errStr.indexOf('connection closed before message completed') !== -1 ||
            errStr.indexOf('Connection reset by peer') !== -1 ||
            errStr.indexOf('The connection was reset') !== -1 ||
            errStr.indexOf('The server closed the connection') !== -1 ||
            errStr.indexOf('Please try sending the request again.') !== -1
        ) {
            console.warn(`... got error ('${errStr}'), retrying fetch() once again`);
            try {
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(fetch(input, { ...init, signal: controller.signal }));
                    }, 0);
                });
            } catch (e) {
                console.error('... got an error on retrying fetch()');
                const msg = `[SBFetch] Error performing fetch() (after RETRY): ${error}`;
                throw new SBError(msg);
            }
        } else {
            const msg = `[SBFetch] Error performing fetch() (this might be normal): ${error}`;
            throw new SBError(msg);
        }
    } finally {
        activeFetches.delete(id);
    }
}

/**
 * Wrapper to SBFetch that applies SB API calling conventions on both sides
 * of the call; it will return whatever data structure the server returns, note
 * that it will extract the reply (either from json or from payload). if there
 * are any issues or if the reply contains an error message, it will throw an
 * error.
 * @internal
 */
export async function SBApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
  let response
  if (DBG0) { console.log(SEP, "[SBApiFetch]", input, SEP) }
  try {
    if (DBG2) { console.log("'sbFetch' is set to:", sbFetch)}
    response = await sbFetch(input, init)
    if (!response) {
      if (DBG0) { console.error("[SBApiFetch] ... server did not repond, will throw")}
      throw new SBError("[SBApiFetch] Server did not respond (might be expected)");
    }

    if (!response.ok) {
      if (DBG0) { console.error("[SBApiFetch] ... response was not OK")}
      const text = await response.text()
      let msg = '[SBApiFetch] Server responded with error\n'
      if (response.status) msg += `  Status code: ('${response.status}')\n`
      if (response.statusText) msg += `  Status text: ('${response.statusText}')\n`
      if (text) msg += `  Error msg:   ('${text}')\n`
      if (DBG0) console.log(msg)
      throw new SBError(msg)
    }

    const contentType = response.headers.get('content-type');
    if (DBG0) { console.log(SEP, "[SBApiFetch] got response, type", contentType, SEP); }
    var retValue: any
    if (!contentType)
      throw new SBError("[SBApiFetch] No content header in server response");

    if (contentType.indexOf("application/json") !== -1) {
      const json = await response.json()
      if (DBG0 || DBG2) console.log(`[SBApiFetch] json ('${json}'):\n`, json)
      retValue = jsonParseWrapper(json, "L489");
    } else if (contentType.indexOf("application/octet-stream") !== -1) {
      retValue = extractPayload(await response.arrayBuffer()).payload
    } else if (contentType.indexOf("text/plain") !== -1) {
      retValue = await response.text()
      // ToDo: possibly add support for server errors such as:
      // 'Your worker restarted mid-request. Please try sending the request again.'
      // ... but then again, Wrangler has soooo many failure modes ...
      throw new SBError(`[SBApiFetch] Server responded with text/plain (?):\n('${retValue}')`);
    } else {
      throw new SBError(`[SBApiFetch] Server responded with unknown content-type header ('${contentType}')`);
    }

    if (/* !response.ok || */ !retValue || retValue.error || retValue.success === false) {
      let apiErrorMsg = '[SBApiFetch] No server response, or cannot parse, or error in response'
      if (response.status) apiErrorMsg += ' [' + response.status + ']'
      if (retValue?.error) apiErrorMsg += ': ' + retValue.error
      if (DBG0 || DBG2) console.error("[SBApiFetch] error:\n", apiErrorMsg)
      throw new SBError(apiErrorMsg)
    } else {
      if (DBG0 || DBG2) console.log(
        "[SBApiFetch] Success:\n",
        SEP, input, '\n',
        SEP, retValue, '\n', SEP)
      return (retValue)
    }

  } catch (e) {
    if (DBG0 || DBG2) console.error(`[SBApiFetch] caught error: ${e}`)
    if (response && response.body && !response.body.locked) {
      // occasionally we need to clean up, if the fetch gave a response but some
      // operation on the response failed (or some other weird stuff happens)
      if (DBG0 || DBG2) console.log('[SBApiFetch] cancelling response body')
      await response.body.cancel();
    }
    if (e instanceof SBError) throw e
    else throw new SBError(`[SBApiFetch] caught error: ${e}`)
  }
}