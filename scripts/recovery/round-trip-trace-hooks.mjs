// Loader hooks for round-trip-trace.mjs. Fails loudly if postgres.js
// changed shape, rather than silently tracing nothing.
const REWRITES = [
  [
    "constructor(strings, args, handler, canceller, options = {}) {",
    "constructor(strings, args, handler, canceller, options = {}) {\n    const __cqStack = new Error().stack;",
  ],
  [
    "this.strings = strings",
    "this.__cqStack = __cqStack\n    this.strings = strings",
  ],
  [
    "!this.executed && (this.executed = true) && await 1 && this.handler(this)",
    "!this.executed && (this.executed = true) && await 1 && (globalThis.__cqQuerySent?.(this.__cqStack), this.handler(this))",
  ],
];

export async function load(url, context, next) {
  const result = await next(url, context);
  if (!url.includes("/postgres/src/query.js")) return result;
  let source = String(result.source);
  for (const [from, to] of REWRITES) {
    if (!source.includes(from)) {
      throw new Error(`round-trip trace: postgres.js no longer has "${from}"`);
    }
    source = source.replace(from, to);
  }
  return { ...result, source };
}
