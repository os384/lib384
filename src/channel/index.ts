// (c) 2023 384 (tm)

import { MessageType, MessageTypeList } from './MessageType';
import { ChannelStream } from './ChannelStream'

import { ChannelApi  } from './ChannelApi'
import { ChannelKeys } from './ChannelKeys'

/** @public */
export const channel = {
    api: ChannelApi,
    types: MessageType,
    typeList: MessageTypeList,
    stream: ChannelStream,
    keys: ChannelKeys,
};
