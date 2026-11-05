/**
 * Where a plan at rest was first shown in the conversation (planLineSpent):
 * the id of the newest turn at that moment, per plan line key. Kept for the
 * tab (sessionStorage, best effort) so a refresh does not bring the line
 * back under "Wait, wait"; in memory when storage is unavailable. Holds
 * only ids and step states, never plan words.
 */

const STORE_KEY = "cq.q.plan-line-seen.v1";
const KEPT_MAX = 40;

const seen = new Map<string, string>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string"
      ) {
        seen.set(entry[0], entry[1]);
      }
    }
  } catch {
    // No storage (private window, server render): memory only.
  }
}

function save(): void {
  try {
    const kept = [...seen.entries()].slice(-KEPT_MAX);
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(kept));
  } catch {
    // Memory only.
  }
}

/**
 * The turn this plan line was first shown under: the stored one when it is
 * still in these turns, else the newest turn now (first sight). Idempotent
 * for the same key and turns, so it is safe to call while rendering.
 */
export function planLineAnchor(
  key: string,
  turns: readonly { readonly id: string }[],
): string | null {
  load();
  const stored = seen.get(key);
  if (stored !== undefined && turns.some((turn) => turn.id === stored)) {
    return stored;
  }
  const newest = turns.at(-1)?.id ?? null;
  if (newest === null) return null;
  seen.set(key, newest);
  save();
  return newest;
}

/** Tests only. */
export function forgetPlanLines(): void {
  seen.clear();
  loaded = true;
  try {
    window.sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Memory only.
  }
}
