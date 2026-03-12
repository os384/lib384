// (c) 2023-2024 384 (tm)

/** @public */
export enum MessageType {
    MSG_SIMPLE_CHAT = "SIMPLE_CHAT_9WbWE53HnRy6", // simple chat message (just text)

    // shard/file sharing
    MSG_FILE_SET = "FILE_SET_FEm4a3EW0cn1", // upon sharing "set" of files (only meta data)
    MSG_NEW_SHARD = "NEW_SHARD_eUp2cR96dH3E", // sent every time a shard/file is seen that's new

    // user private data
    MSG_USER_PRIVATE_DATA = "USER_PRIVATE_DATA_R0FR1LWRRddE", // any private (meta whatever) data a user wants to record

    // communication around user identities
    MSG_NEW_USER_KEY = "NEW_USER_KEY_20m0r6rFedac", // when users lock in their key they send this
    MSG_CLAIM_PUBLIC_KEY = "CLAIM_PUBLIC_KEY_8pc2FamHdrhW", // when a user claims a public key, they send this

    // 'parent' channel communication
    MSG_CONTACT_ANNOUNCEMENT = "CONTACT_ANNOUNCEMENT_mEe6d97kEbhR", // Announces a new contact based on the configuration and new public key in main channel
    MSG_REQUEST_MAIN = "REQUEST_MAIN_1pE8de4bEWRE", // sent to request the main channel (which is another one)
    MSG_PROVIDE_MAIN = "PROVIDE_MAIN_Ea66FnFE9f5F", // reply to request; the provision needs to be encrypted for the recipient
}

export const MessageTypeList = [
    MessageType.MSG_SIMPLE_CHAT,
    MessageType.MSG_FILE_SET,
    MessageType.MSG_NEW_SHARD,
    MessageType.MSG_NEW_USER_KEY,
    MessageType.MSG_USER_PRIVATE_DATA,
    MessageType.MSG_CLAIM_PUBLIC_KEY,
    MessageType.MSG_REQUEST_MAIN,
    MessageType.MSG_PROVIDE_MAIN,
    MessageType.MSG_CONTACT_ANNOUNCEMENT,
];
