import * as React from "react";

/**
 * Per-request memoisation for server lookups (React cache). Inside a Next.js
 * server render, a layout and its page asking the same question share one
 * database round trip. Outside one (tests, scripts) React has no request scope,
 * so this falls back to calling the function every time — correct, just uncached.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => any;
const reactCache = (React as unknown as { cache?: <T extends Fn>(fn: T) => T }).cache;

export function requestCache<T extends Fn>(fn: T): T {
  return reactCache ? reactCache(fn) : fn;
}
