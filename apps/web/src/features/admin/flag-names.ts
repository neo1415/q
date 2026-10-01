/**
 * A feature flag's name as the console shows it. Plain module, not the
 * client one: the flags page is a server component and calls this while
 * rendering (live 2026-10-01: importing it from the "use client" module
 * made /admin/flags fail with "flagName is on the client").
 */
const NAMES: Readonly<Record<string, string>> = {
  "q.autonomy.errands": "Let Q handle this (errands)",
  "q.autonomy.delegations": "Standing delegations",
  "q.daily": "The Q Daily",
};

export function flagName(key: string): string {
  return NAMES[key] ?? key;
}
