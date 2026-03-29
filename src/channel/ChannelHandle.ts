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
import { SB_CHANNEL_HANDLE_SYMBOL } from './Channel'

import {
  _sb_assert, ChannelId,
  SBUserPrivateKey, SBError,
  DBG2,
} from 'src/common'

import { SBChannelData, _check_SBChannelData } from './Channel'

/** 
 * Channel 'descriptor'. Validator is {@link validate_ChannelHandle}.
 * @public
 */
export interface ChannelHandle {
  [SB_CHANNEL_HANDLE_SYMBOL]?: boolean, // future use for internal validation

  /** minimum info is the key */
  userPrivateKey: SBUserPrivateKey,

  /** if channelID is omitted, then the key will be treated as the Owner key
      (channelId is always derived from owner key) */
  channelId?: ChannelId,

  /** if channel server is omitted, will use default (global) server */
  channelServer?: string,

  /** server-side channel data; if missing the server can provide it; if the
      handle is meant to be 'completely stand-alone', it's good practice to
      include this */
  channelData?: SBChannelData,
}

// returns true of false, does not throw
/** @internal */
export function _check_ChannelHandle(data: ChannelHandle) {
  if (!data) return false
  return (
    Object.getPrototypeOf(data) === Object.prototype
    && data.userPrivateKey && typeof data.userPrivateKey === 'string' && data.userPrivateKey.length > 0
    && (!data.channelId || (typeof data.channelId === 'string' && data.channelId.length === 43))
    && (!data.channelServer || typeof data.channelServer === 'string')
    && (!data.channelData || _check_SBChannelData(data.channelData))
  )
}

/**
 * Validates 'ChannelHandle', throws if there's an issue
 * @public
 */
export function validate_ChannelHandle(data: ChannelHandle): ChannelHandle {
  if (!data) throw new SBError(`invalid ChannelHandle (null or undefined)`)
  else if (data[SB_CHANNEL_HANDLE_SYMBOL]) return data as ChannelHandle
  else if (_check_ChannelHandle(data)) {
    return { ...data, [SB_CHANNEL_HANDLE_SYMBOL]: true } as ChannelHandle
  } else {
    if (DBG2) console.error('invalid ChannelHandle ... trying to ingest:\n', data)
    throw new SBError(`invalid ChannelHandle`)
  }
}
