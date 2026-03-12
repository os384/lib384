// (c) 384 2023-2024 (tm)

// nonces are on occasion directly manipulated (eg increments), salt i always
// a pass-through value    

export type SALT_TYPE = ArrayBuffer;
export const SALT_CONSTRUCTOR = ArrayBuffer;
export type NONCE_TYPE = Uint8Array; // iv
export const NONCE_CONSTRUCTOR = Uint8Array;
