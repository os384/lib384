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
/**
 * Will retry 'something', regardless of reason of failure. Typically used
 * for things like server API calls where there might be glitches. Note
 * that it will wait a little bit between retries. Optional second
 * argument is the number of milliseconds to wait between retries
 * (default is 200).
 */
export function Retry(retries: number, ms = 200) {
    return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any[]) {
            let attempt = 0;
            const execute = async (): Promise<any> => {
                try {
                    return await originalMethod.apply(this, args);
                } catch (error) {
                    if (attempt < retries) {
                        attempt++;
                        console.warn(`Method '${propertyKey}' got an error (could be a timeout), will retry - next will be ${attempt}/${retries}\nError was:`, error);
                        // we first wait a bit before retrying
                        await new Promise(resolve => setTimeout(resolve, ms));
                        return execute(); // Recursively retry
                    } else {
                        throw error; // Rethrow after all retries are exhausted
                    }
                }
            };
            return execute();
        };
    };
}

// function Timeout(ms: number) {
//     return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
//         const originalMethod = descriptor.value;
//         descriptor.value = function (...args: any[]) {
//             return new Promise((resolve, reject) => {
//                 const timer = setTimeout(() => {
//                     reject(new Error(`Method '${propertyKey}' timed out after ${ms} ms`));
//                 }, ms);
//                 originalMethod.apply(this, args).then(
//                     (response) => {
//                         clearTimeout(timer);
//                         resolve(response);
//                     },
//                     (error) => {
//                         clearTimeout(timer);
//                         reject(error);
//                     }
//                 );
//             });
//         };
//     };
// }

function withTimeoutRetry<T>(promiseFn: () => Promise<T>, ms: number, retries: number, methodName: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let attempts = 0;
        const attempt = () => {
            const timeout = new Promise<T>((_, timeoutReject) => {
                const id = setTimeout(() => {
                    clearTimeout(id);
                    timeoutReject(new Error(`Method '${methodName}' timed out (each attempt got ${ms} ms).` + (attempts > 0 ? ` After ${attempts + 1} attempts.` : '')));
                }, ms);
            });

            Promise.race([promiseFn(), timeout]).then(resolve, async error => {
                if (attempts < retries) {
                    attempts++;
                    console.log(`Method '${methodName}' timed out, will retry - next will be ${attempts}/${retries}`);
                    // we first wait a bit before retrying
                    await new Promise(resolve => setTimeout(resolve, 200));
                    attempt(); // retry
                } else {
                    reject(error);
                }
            });
        };
        attempt();
    });
}

/**
 * Decorator to add a timeout with retry logic to a method. Retries defaults to zero.
 *
 * Example:
 *
 * ```ts
 *   class DataLoader {
 *      @Timeout(500, 2)
 *      async fetchData() {
 *        return new Promise(resolve => setTimeout(() => resolve("Data loaded"), 1000));
 *      }
 *    }
 * ```
 */
export function Timeout(ms: number, retries: number = 0) {
    return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any[]) {
            return withTimeoutRetry(() => originalMethod.apply(this, args), ms, retries, propertyKey);
        };
    };
}


/**
 * Similar to Timeout, but with a hard-coded timeout value of 500 ms
 * @internal
 */
export function Timeout500(_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const ms = 500; // Hard-coded timeout value

    descriptor.value = function (...args: any[]) {
        const timeoutPromise = new Promise((_, reject) => {
            const id = setTimeout(() => {
                clearTimeout(id);
                reject(new Error(`Method '${propertyKey}' timed out after ${ms} ms`));
            }, ms);
        });

        return Promise.race([
            originalMethod.apply(this, args),
            timeoutPromise
        ]);
    };
}

// /* earlier version */
// function withTimeout<T>(promise: Promise<T>, ms: number, methodName: string): Promise<T> {
//     const timeout = new Promise<T>((_, reject) => {
//         const id = setTimeout(() => {
//             clearTimeout(id);
//             reject(new Error(`Method '${methodName}' timed out after ${ms} ms`));
//         }, ms);
//     });
//     return Promise.race([promise, timeout]);
// }

// export function Timeout(ms: number) {
//     return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
//         const originalMethod = descriptor.value;
//         descriptor.value = function (...args: any[]) {
//             return withTimeout(originalMethod.apply(this, args), ms, propertyKey);
//         };
//     };
// }
