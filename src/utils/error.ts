// (c) 2023 384 (tm)

const DBG0 = false

declare var DBG2: boolean;

import { SEP } from 'src/utils/sep'

// variation on solving this issue:
// https://kentcdodds.com/blog/get-a-catch-block-error-message-with-typescript
// @internal
export function WrapError(e: any) {
    const pre = ' *ErrorStart* ', post = ' *ErrorEnd* '; // only for 'unknown' sources
    if (e instanceof SBError) {
      return e
    } else if (e instanceof Error) {
      // could use 'e' here, but some variations of 'e' do not allow 'message' to be accessed
      if (DBG0) console.error('[WrapError] Error: \n', e)
      return new SBError(pre + e.message + post)
    }
    else return new SBError(pre + String(e) + post);
  }
  
  // @internal
  export function _sb_exception(loc: string, msg: string) {
    const m = '[_sb_exception] << SB lib error (' + loc + ': ' + msg + ') >>';
    // for now disabling this to keep node testing less noisy
    // console.error(m);
    throw new SBError(m);
  }
  
  // @internal
  export function _sb_assert(val: unknown, msg: string) {
    if (!(val)) {
      const m = ` <<<<[_sb_assert] assertion failed: '${msg}'>>>> `;
      if (DBG0) console.trace(m)
      throw new SBError(m);
    }
  }
  
  /** @internal */
  export class SBError extends Error {
    constructor(message: string) {
      super(message);
      this.name = this.constructor.name;
      if (typeof (Error as any).captureStackTrace === 'function')
        (Error as any).captureStackTrace(this, this.constructor);
      else
        this.stack = (new Error(message)).stack;
      if (DBG2) {
        let atLine: string | null = null
        if (this.stack) {
          const stackLines = this.stack!.split("\n");
          for (let i = 1; i < stackLines.length; i++) {
            if (stackLines[i].trim().startsWith("at")) {
              atLine = `${stackLines[i].trim()}`
              break;
            }
          }
        }
        if (atLine !== null)
          console.log('\n', SEP, 'SBError():\n', "'" + message + "'", '\n', atLine, '\n', SEP)
        else
          console.log('\n', SEP, 'SBError():\n', message, '\n', SEP)
      }
    }
  }
  