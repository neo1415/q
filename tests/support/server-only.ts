/**
 * A stand-in for the `server-only` marker package, for the Vitest runner.
 *
 * `server-only` throws on import so that a module meant for the server can
 * never be pulled into a browser bundle. That guard is real and stays: it is
 * what keeps `getSessionAccessToken` and the Auth-provider lookup out of the
 * client. But Vitest is neither a browser bundle nor a React Server
 * Component, so importing such a module to test it would trip the guard for
 * no reason.
 *
 * The package ships exactly this empty module for the `react-server`
 * condition; the runner is pointed at a local copy because the subpath is
 * not exported. Nothing is weakened — the alias exists only in
 * vitest.config.ts, never in a build.
 */
export {};
