import { voiceAudioHeld } from "@/features/voice/voice-audio";

/**
 * The client routers Q's moves go through (moved here from client-actions
 * so the navigation lifecycle can own execution without an import cycle).
 *
 * - The page's Q session registers the app router it holds; moving through
 *   it keeps the page's JavaScript -- and Q's open voice line -- alive
 *   (founder report 2026-09-30: a full page load "stops listening").
 * - The shell (QControlRuntime, mounted by every signed-in layout) registers
 *   its own, so a page's Q session remounting never leaves moves without a
 *   router (V's live test 2026-10-09: a delegated open landed by a HARD
 *   RELOAD, which ends the voice call).
 */
export type RouterPush = (path: string) => void;

let clientRouterPush: RouterPush | null = null;
let shellRouterPush: RouterPush | null = null;
const waiters = new Set<() => void>();

function changed(): void {
  for (const wake of [...waiters]) wake();
}

export function registerClientRouter(push: RouterPush | null): void {
  clientRouterPush = push;
  changed();
}

export function registerShellRouter(push: RouterPush | null): void {
  shellRouterPush = push;
  changed();
}

/** The router a move goes through now, or null when none is registered. */
export function routerNow(): RouterPush | null {
  return clientRouterPush ?? shellRouterPush;
}

/**
 * Calls `then` with a router now, or the moment one registers (in the same
 * task as the registration), or with null after `ms`. Returns a cancel.
 */
export function withRouter(
  ms: number,
  then: (push: RouterPush | null) => void,
): () => void {
  const now = routerNow();
  if (now !== null) {
    then(now);
    return () => undefined;
  }
  let done = false;
  const finish = (push: RouterPush | null) => {
    if (done) return;
    done = true;
    waiters.delete(wake);
    clearTimeout(timer);
    then(push);
  };
  const wake = () => {
    const push = routerNow();
    if (push !== null) finish(push);
  };
  const timer = setTimeout(() => finish(null), ms);
  waiters.add(wake);
  return () => {
    done = true;
    waiters.delete(wake);
    clearTimeout(timer);
  };
}

/** The last resort: a full page load (tests replace it to observe it). */
let hardLoad: (path: string) => void = (path) => window.location.assign(path);
export function setHardLoad(next: ((path: string) => void) | null): void {
  hardLoad = next ?? ((path) => window.location.assign(path));
}

/**
 * A full page load, unless a voice call holds the audio (it would end the
 * call): false when it was refused.
 */
export function hardLoadUnlessVoice(path: string): boolean {
  if (voiceAudioHeld()) return false;
  hardLoad(path);
  return true;
}

/** The app router's prefetch, for a target read while they still speak. */
let clientRouterPrefetch: ((path: string) => void) | null = null;
export function registerClientPrefetch(
  prefetch: ((path: string) => void) | null,
): void {
  clientRouterPrefetch = prefetch;
}
export function prefetchPath(path: string): void {
  clientRouterPrefetch?.(path);
}
