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
import { SB384 } from '../sbCrypto/SB384'
import {SB_CHANNEL_HANDLE_SYMBOL} from './Channel'

const DBG0 = false

import {
    _sb_assert, ChannelId,
    SBUserPrivateKey, SBError,
    DBG2, Memoize, Ready,
    assemblePayload,
    sbCrypto,
    SBApiFetch
} from 'src/common'

import { WrapError } from 'src/utils/error'

import { SBChannelData, _check_SBChannelData, validate_SBChannelData } from './Channel'

import { ChannelApi, ChannelApiBody, validate_ChannelApiBody } from './ChannelApi'
import { ChannelHandle, validate_ChannelHandle, _check_ChannelHandle } from './ChannelHandle'

import { _appendBuffers } from 'src/utils/buffers'


/**
 * The minimum state of a Channel is the "user" keys, eg how we identify when
 * connecting to the channel.
 *
 * We can construct them from a {@link ChannelHandle} or from a {@link SBUserPrivateKey}.
 */
export class ChannelKeys extends SB384 {
    #channelId?: ChannelId
    sbChannelKeysReady: Promise<ChannelKeys>
    static ReadyFlag = Symbol('SBChannelKeysReadyFlag'); // see below for '(this as any)[<class>.ReadyFlag] = false;'
    #channelData?: SBChannelData

    /** Private storage for the channel server */
    #channelServer?: string

    /**
     * Gets the channel server for this instance.
     * Falls back to the global default channel server if not explicitly set.
     */
    get channelServer(): string {
        if (this.#channelServer) { return this.#channelServer; }
        try {
            return ChannelApi.defaultChannelServer;
        } catch (e) {
            throw new SBError("[ChannelKeys] No channel server provided and no global default available");
        }
    }

    /** Sets the channel server for this instance.  */
    set channelServer(value: string | undefined) {
        if (value) {
            // Ensure no trailing slash
            if (value[value.length - 1] === '/') {
                this.#channelServer = value.slice(0, -1);
            } else {
                this.#channelServer = value;
            }
        } else {
            this.#channelServer = undefined;
        }
    }
  
    constructor(handleOrKey?: ChannelHandle | SBUserPrivateKey) {
      // undefined (missing) is fine, but 'null' is not
      let channelServer: string | undefined
      if (handleOrKey === null) throw new SBError(`ChannelKeys constructor: you cannot pass 'null'`)
      if (handleOrKey) {
        if (typeof handleOrKey === 'string') {
          // we're provided an owner private key
          const ownerPrivateKey = handleOrKey as SBUserPrivateKey
          super(ownerPrivateKey, true)
        } else if (_check_ChannelHandle(handleOrKey)) {
          const handle = validate_ChannelHandle(handleOrKey)
          channelServer = handle.channelServer
          super(handle.userPrivateKey, true);
          this.#channelId = handle.channelId
          this.#channelData = handle.channelData // which might not be there
        } else {
          throw new SBError(`ChannelKeys() constructor: invalid parameter (must be ChannelHandle or SBUserPrivateKey)`)
        }
      } else {
        // brand new, state will be derived from SB384 keys
        super()
      }

      // Set the channel server if provided from the handle
      if (channelServer) {
        this.channelServer = channelServer;
      }
      // Note: If no channel server is provided, the getter will fall back to the global default when needed
  
      (this as any)[ChannelKeys.ReadyFlag] = false
      this.sbChannelKeysReady = new Promise<ChannelKeys>(async (resolve, reject) => {
        try {
          if (DBG0) console.log("ChannelKeys() constructor.")
          // wait for parent keys (super)
          await this.sb384Ready; _sb_assert(this.private, "Internal Error [L2833]")
          // either channelId wasn't provided (in which case we must be owner)
          // or it was (and we're also the owner)
          if (!this.#channelId || this.owner) {
            if (!this.#channelId) this.#channelId = this.ownerChannelId
            this.#channelData = {
              channelId: this.ownerChannelId,
              ownerPublicKey: this.userPublicKey
            }
          } else if (!this.#channelData) {
            // we're not owner, and we haven't gotten the ownerPublicKey, so we need to ask the server
            if (!this.channelServer)
              throw new SBError("ChannelKeys() constructor: either key is owner key, or handle contains channelData, or channelServer is provided ...")
            if (DBG0) console.log("++++ ChannelKeys being initialized from server")
            var cpk: SBChannelData
            try {
              cpk = await this.callApi('/getChannelKeys')
            } catch (e) {
              // any errors, and we wait 1 second and then try again, until it works
              while (true) {
                let count = 0
                await new Promise(resolve => setTimeout(resolve, 75))
                try {
                  cpk = await this.callApi('/getChannelKeys')
                  break
                } catch (e) {
                  // ToDo: these retries should be behind a ChannelApi 'back online' event;
                  // and in any case a Channel can be 'partly' ready without channel keys.
                  // right now proper offline resilience only works for owner keys.
                  // we limit retries regardless
                  if (count++ > 6)
                    throw new SBError("ChannelKeys() constructor: failed to get channel data, retrying ...")
                  console.error("ChannelKeys() constructor: failed to get channel data, retrying ...")
                }
              }
            }
            cpk = validate_SBChannelData(cpk) // throws if there's an issue
            // we have the authoritative keys from the server, sanity check
            _sb_assert(cpk.channelId === this.#channelId, "Internal Error (L2493)")
            this.#channelData = cpk
          }
          // should be all done at this point
          (this as any)[ChannelKeys.ReadyFlag] = true;
          resolve(this)
        } catch (e) {
          reject('[ChannelKeys] constructor failed. ' + WrapError(e))
        }
      })
    }
  
    get ready() { return this.sbChannelKeysReady }
    get SBChannelKeysReadyFlag() { return (this as any)[ChannelKeys.ReadyFlag] }
  
    @Memoize get owner() { return this.private && this.ownerChannelId && this.channelId && this.ownerChannelId === this.channelId }
    @Memoize get channelId() {
      if (this.#channelId) return this.#channelId
      else throw new SBError("[ChannelKeys] ChannelID not known / object not ready. Internal Error (L894)")
    }
  
    @Memoize @Ready get channelData() { return this.#channelData! }
  
  
    @Memoize @Ready get handle(): ChannelHandle {
      return {
        [SB_CHANNEL_HANDLE_SYMBOL]: true,
        channelId: this.channelId!,
        userPrivateKey: this.userPrivateKey,
        // channelPrivateKey: this.channelUserPrivateKey,
        channelServer: this.channelServer,
        channelData: this.channelData
      }
    }
  
    async buildApiBody(path: string, apiPayload?: any) {
      await this.sb384Ready // enough for signing
      const timestamp = await ChannelApi.dateNow() // todo: x256 string format
      const viewBuf = new ArrayBuffer(8);
      const view = new DataView(viewBuf);
      view.setFloat64(0, timestamp);
      const pathAsArrayBuffer = new TextEncoder().encode(path).buffer
      const prefixBuf = _appendBuffers([viewBuf, pathAsArrayBuffer])
      const apiPayloadBuf = apiPayload ? assemblePayload(apiPayload)! : undefined
      // sign with userId key, covering timestamp + path + apiPayload
      const sign = await sbCrypto.sign(this.signKey, apiPayloadBuf ? _appendBuffers([prefixBuf, apiPayloadBuf]) : prefixBuf)
      const apiBody: ChannelApiBody = {
        channelId: this.#channelId!,
        path: path,
        userId: this.userId,
        userPublicKey: this.userPublicKey,
        timestamp: timestamp,
        sign: sign
      }
      if (apiPayloadBuf) apiBody.apiPayloadBuf = apiPayloadBuf
      return validate_ChannelApiBody(apiBody)
    }
  
    /**
      * Implements Channel api calls.
      * 
      * Note that the API call details are also embedded in the ChannelMessage,
      * and signed by the sender, completely separate from HTTP etc auth.
      */
    callApi(path: string): Promise<any>
    callApi(path: string, apiPayload: any): Promise<any>
    callApi(path: string, apiPayload?: any): Promise<any> {
      _sb_assert(this.channelServer, "[ChannelApi.callApi] No channel server available. Either set it explicitly or ensure a global default exists.")
      if (DBG0) console.log("ChannelApi.callApi: calling fetch with path:", path)
      if (DBG2) console.log("... and body:", apiPayload)
      _sb_assert(this.#channelId && path, "Internal Error (L2528)")
      // todo: we can add 'GET' support with apiBody put into search term,
      //       if we want that (as we're forced to do for web sockets)
      return new Promise(async (resolve, reject) => {
        const init: RequestInit = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream"',
          },
          body: assemblePayload(await this.buildApiBody(path, apiPayload))
        }
        if (DBG2) console.log("==== ChannelApi.callApi: calling fetch with init:\n", init)
        SBApiFetch(this.channelServer + '/api/v2/channel/' + this.#channelId! + path, init)
          .then((ret: any) => { resolve(ret) })
          .catch((e: Error) => {
            if (e instanceof SBError) reject(e)
            else reject("[Channel.callApi] Error: " + WrapError(e))
          })
      })
    }
  
  
  } /* class ChannelKeys */
  