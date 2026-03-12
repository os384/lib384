// Local shim for @std/assert — used when jsr.io is not accessible (e.g., in CI sandboxes).
// Implements the subset of @std/assert used by this test suite.
// SPDX-License-Identifier: MIT (matches @std/assert original license)

export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? "Assertion failed");
  }
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!deepEqual(actual, expected)) {
    const actualStr = formatValue(actual);
    const expectedStr = formatValue(expected);
    throw new Error(message ?? `Values are not equal:\n  actual: ${actualStr}\n  expected: ${expectedStr}`);
  }
}

export function assertNotEquals<T>(actual: T, expected: T, message?: string): void {
  if (deepEqual(actual, expected)) {
    throw new Error(message ?? `Expected values to be different but both are: ${formatValue(actual)}`);
  }
}

export function assertExists<T>(actual: T, message?: string): asserts actual is NonNullable<T> {
  if (actual === undefined || actual === null) {
    throw new Error(message ?? `Expected value to exist, but got: ${actual}`);
  }
}

export function assertThrows(
  fn: () => unknown,
  ErrorClass?: (new (...args: unknown[]) => Error) | { prototype: Error },
  msgIncludes?: string,
  message?: string,
): Error {
  let threw = false;
  let caughtErr: unknown;
  try {
    fn();
  } catch (err) {
    threw = true;
    caughtErr = err;
  }
  if (!threw) {
    throw new Error(message ?? "Expected function to throw, but it did not");
  }
  if (ErrorClass) {
    if (!(caughtErr instanceof (ErrorClass as new (...args: unknown[]) => Error))) {
      throw new Error(
        message ??
          `Expected error to be instance of ${(ErrorClass as { name?: string }).name ?? "ErrorClass"}, got: ${formatValue(caughtErr)}`,
      );
    }
  }
  if (msgIncludes !== undefined) {
    const errMsg = caughtErr instanceof Error ? caughtErr.message : String(caughtErr);
    if (!errMsg.includes(msgIncludes)) {
      throw new Error(
        message ??
          `Expected error message to include "${msgIncludes}" but got: "${errMsg}"`,
      );
    }
  }
  return caughtErr as Error;
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  ErrorClass?: (new (...args: unknown[]) => Error) | { prototype: Error },
  msgIncludes?: string,
  message?: string,
): Promise<Error> {
  let threw = false;
  let caughtErr: unknown;
  try {
    await fn();
  } catch (err) {
    threw = true;
    caughtErr = err;
  }
  if (!threw) {
    throw new Error(message ?? "Expected async function to reject, but it did not");
  }
  if (ErrorClass) {
    if (!(caughtErr instanceof (ErrorClass as new (...args: unknown[]) => Error))) {
      throw new Error(
        message ??
          `Expected rejection to be instance of ${(ErrorClass as { name?: string }).name ?? "ErrorClass"}, got: ${formatValue(caughtErr)}`,
      );
    }
  }
  if (msgIncludes !== undefined) {
    const errMsg = caughtErr instanceof Error ? caughtErr.message : String(caughtErr);
    if (!errMsg.includes(msgIncludes)) {
      throw new Error(
        message ??
          `Expected rejection message to include "${msgIncludes}" but got: "${errMsg}"`,
      );
    }
  }
  return caughtErr as Error;
}

// ---- helpers ----

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

function formatValue(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
