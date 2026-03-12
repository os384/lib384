// (c) 2024 384 (tm)

/**
 * Maximum allowed size of a channel message body.
 * In principle these could be much (much) bigger; but the intent of Channels is
 * lots of small 'messages', anything 'big' should be managed as shards, and the
 * handles of such shards sent in messages. There are good arguments for allowing
 * larger messages, especially if ephemeral, but it's always easy to INCREASE
 * max size, harder to decrease. Also, storage cost of messages is much higher than
 * shard storage, so we don't want to inadvertently encourage unnecessary channel
 * budget consumption.
 * 
 * @public
 */
export const MAX_SB_BODY_SIZE = 64 * 1024

/**
 * time we wait for a send() not to do anything before we interpret it as an
 * error and reset, and time we wait when creating a websocket before we
 * interpret the attempt as failed, and finally number of times to retry
 * before giving up on a message (each retry will reset the socket)
 * @internal
 */
export const WEBSOCKET_MESSAGE_TIMEOUT = 20000 // ms   // ... testing resilience
export const WEBSOCKET_SETUP_TIMEOUT = 2000 // ms
export const WEBSOCKET_RETRY_COUNT = 3

/**
 * time in ms between 'ping' messages; in other words, on average we are about
 * half of this behind IF the socket has hibernated. if the edge server stack
 * does not support hibernation, then the channel server will respond instead.
 * @internal
 */
export const WEBSOCKET_PING_INTERVAL = 1000

/**
 * minimum when creating a new channel. channels can be reduced below this, but
 * not created below this. todo: this should be from a server config.
 * @internal
 */
export const NEW_CHANNEL_MINIMUM_BUDGET = 8 * 1024 * 1024; // 8 MB
