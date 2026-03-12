// (c) 2023 384 (tm)

const DBG0 = false;

// export declare var DBG2: boolean;
export var DBG2 = false;

export const _SEP_ = '='.repeat(76)
export const SEP = '\n' + _SEP_ + '\n'
export const _SEP = '\n' + _SEP_
export const SEP_ = _SEP_ + '\n'

// true if value is null or undefined. less confusing than using '==' in code.
export function isNil(value: any): value is null | undefined {
  return value == null; // deliberate use of '==' (do not use '===')
}

// common SB384 types (to facilitate imports)

/** Generic 256-bit hash identifier (43 x base62) @public */
export type SB384Hash = string

/** User ID (name). @public */
export type SBUserId = SB384Hash // 256 bit hash (43 x base62)

/**
 * Checks if a string looks like a valid SBUserId. Note that this is a hash,
 * so, in the absence of more information it cannot be 'validated' per se.
 * @public
 */
export function isSBUserId(x: any): x is SBUserId {
  const b62regex = /^[A-Za-z0-9]*$/; // copy from b62.ts
  const ret = (typeof x === 'string' && x.length === 43 && b62regex.test(x))
  if (DBG0 && !ret) console.log(`isSBUserId(${x}) => ${ret}`)
  return ret 
}

/** Channel ID (name). @public */
export type ChannelId = SB384Hash // same format, always the owner's hash

/** Public key encoding. @public */
export type SBUserPublicKey = string

export function isSBUserPublicKey(x: any): x is SBUserPublicKey {
  return (typeof x === 'string' && x.length > 0)
}

/** Private key encoding. @public */
export type SBUserPrivateKey = string

// we re-export a few common things from here
export { extractPayload, assemblePayload } from './utils/payloads';

export { sbCrypto } from './sbCrypto/index'

import { _sb_assert } from 'src/utils/error';
export { SBError, _sb_assert } from 'src/utils/error';

export { jsonParseWrapper } from 'src/utils/json';

export { SBApiFetch } from 'src/utils/fetch';

export function isSet<T>(value: unknown): value is Set<T> {
  return value instanceof Set;
}
export function isMap<K, V>(value: unknown): value is Map<K, V> {
  return value instanceof Map;
}
export function isArray<T>(value: unknown): value is Array<T> {
  return Array.isArray(value);
}

// Decorator
// caches resulting value (after any verifications eg ready pattern)
/** @internal */
export function Memoize(target: any, propertyKey: string /* ClassGetterDecoratorContext */, descriptor?: PropertyDescriptor) {
  if ((descriptor) && (descriptor.get)) {
    let get = descriptor.get
    descriptor.get = function () {
      const prop = `__${target.constructor.name}__${propertyKey}__`
      if (this.hasOwnProperty(prop)) {
        const returnValue = this[prop as keyof PropertyDescriptor]
        return (returnValue)
      } else {
        const returnValue = get.call(this)
        Object.defineProperty(this, prop, { configurable: false, enumerable: false, writable: false, value: returnValue })
        return returnValue
      }
    }
  }
}

// Decorator
// asserts that corresponding object is 'ready'; also asserts non-null getter return value
/** @internal */
export function Ready(target: any, propertyKey: string /* ClassGetterDecoratorContext */, descriptor?: PropertyDescriptor) {
  if ((descriptor) && (descriptor.get)) {
    let get = descriptor.get
    descriptor.get = function () {
      const obj = target.constructor.name
      const readyFlagSymbol = target.constructor.ReadyFlag;
      // todo: consider adding 'errorState' as general blocker
      // if (DBG0) console.log(`Ready: ${obj}.${propertyKey} constructor:`, target.constructor)
      _sb_assert(readyFlagSymbol in this, `'readyFlagSymbol' missing yet getter accessed with @Ready pattern (fatal)`);
      _sb_assert((this as any)[readyFlagSymbol], `'${obj}.${propertyKey}' getter accessed but object not 'ready' (fatal)`);
      const retValue = get.call(this);
      _sb_assert(retValue !== null, `'${obj}.${propertyKey}' getter accessed but return value will be NULL (fatal)`);
      return retValue;
    }
  }
}


// // Decorator
// // asserts any types that are SB classes are valid
// // we're not quite doing this yet. interfaces would be more important to handle in this manner,
// // however even with new (upcoming) additional type metadata for decorators, can't yet be done.
// function VerifyParameters(_target: any, _propertyKey: string /* ClassMethodDecoratorContext */, descriptor?: PropertyDescriptor): any {
//   if ((descriptor) && (descriptor.value)) {
//     const operation = descriptor.value
//     descriptor.value = function (...args: any[]) {
//       for (let x of args) {
//         const m = x.constructor.name
//         if (isSBClass(m)) _sb_assert(SBValidateObject(x, m), `invalid parameter: ${x} (expecting ${m})`)
//       }
//       return operation.call(this, ...args)
//     }
//   }
// }

// // Decorator
// // turns any exception into a reject
// function ExceptionReject(target: any, _propertyKey: string /* ClassMethodDecoratorContext */, descriptor?: PropertyDescriptor) {
//   if ((descriptor) && (descriptor.value)) {
//     const operation = descriptor.value
//     descriptor.value = function (...args: any[]) {
//       try {
//         return operation.call(this, ...args)
//       } catch (e) {
//         console.log(`ExceptionReject: ${WrapError(e)}`)
//         console.log(target)
//         console.log(_propertyKey)
//         console.log(descriptor)
//         return new Promise((_resolve, reject) => reject(`Reject: ${WrapError(e)}`))
//       }
//     }
//   }
// }



if (typeof WeakRef === "undefined") {
  class PolyfillWeakRef<T> {
      private _target: T;
      constructor(target: T) {
          this._target = target;
      }
      deref(): T | undefined {
          return this._target;
      }
  }
  Object.defineProperty(PolyfillWeakRef.prototype, Symbol.toStringTag, {
      value: 'WeakRef',
      configurable: true,
  });
  globalThis.WeakRef = PolyfillWeakRef as any;
}
