/**
 * What the person typed in onboarding and Q has not confirmed yet, kept in
 * this browser per interview (onboarding speed 2026-10-20, D7).
 *
 * A closed tab, a reload or a dropped connection used to lose two things:
 * words still in the composer, and a message sent whose reply never came
 * (the server keeps a message only once it reaches Q). Both are held here
 * until Q's reply confirms the message, and offered back on return.
 *
 * Per-viewer convenience only: storage can be missing, full or blocked (a
 * private window), so every read and write is guarded and the screen works
 * without it. Nothing here is authority: a restored message is shown as not
 * answered and is sent again only when the person chooses to.
 */

export type OnboardingDraft = {
  /** Words in the composer, not yet sent. */
  readonly typing: string;
  /** Messages sent whose reply has not been confirmed, oldest first. */
  readonly pending: readonly string[];
};

const EMPTY: OnboardingDraft = { typing: "", pending: [] };
const PREFIX = "cq.onboarding.draft.";
/** Bounds what one interview may keep. */
const MAX_PENDING = 8;
const MAX_CHARS = 8_000;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft(
  sessionId: string,
  store: DraftStorage | null = storage(),
): OnboardingDraft {
  if (store === null) return EMPTY;
  try {
    const raw = store.getItem(`${PREFIX}${sessionId}`);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const record = parsed as Record<string, unknown>;
    const typing =
      typeof record["typing"] === "string"
        ? record["typing"].slice(0, MAX_CHARS)
        : "";
    const pending = Array.isArray(record["pending"])
      ? record["pending"]
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.slice(0, MAX_CHARS))
          .filter((item) => item.trim().length > 0)
          .slice(-MAX_PENDING)
      : [];
    return { typing, pending };
  } catch {
    return EMPTY;
  }
}

function writeDraft(
  sessionId: string,
  draft: OnboardingDraft,
  store: DraftStorage | null,
): void {
  if (store === null) return;
  try {
    const key = `${PREFIX}${sessionId}`;
    if (draft.typing.trim().length === 0 && draft.pending.length === 0) {
      store.removeItem(key);
      return;
    }
    store.setItem(
      key,
      JSON.stringify({
        typing: draft.typing.slice(0, MAX_CHARS),
        pending: draft.pending.slice(-MAX_PENDING),
      }),
    );
  } catch {
    // Storage full or blocked: the screen carries on without the draft.
  }
}

export function keepTyping(
  sessionId: string,
  typing: string,
  store: DraftStorage | null = storage(),
): void {
  writeDraft(sessionId, { ...readDraft(sessionId, store), typing }, store);
}

/** A message is on its way: held until its reply is confirmed. */
export function holdPending(
  sessionId: string,
  text: string,
  store: DraftStorage | null = storage(),
): void {
  const current = readDraft(sessionId, store);
  writeDraft(
    sessionId,
    { ...current, pending: [...current.pending, text] },
    store,
  );
}

/** Q answered it: nothing of it needs keeping here any more. */
export function confirmSent(
  sessionId: string,
  text: string,
  store: DraftStorage | null = storage(),
): void {
  const current = readDraft(sessionId, store);
  const index = current.pending.indexOf(text);
  if (index === -1) return;
  writeDraft(
    sessionId,
    {
      ...current,
      pending: [
        ...current.pending.slice(0, index),
        ...current.pending.slice(index + 1),
      ],
    },
    store,
  );
}

/**
 * The pending messages the server never kept, given the person's lines it
 * did keep: those still need sending. One that reached Q is on the thread
 * already, and is not offered twice.
 */
export function unsentAfterReload(
  pending: readonly string[],
  keptPersonLines: readonly string[],
): readonly string[] {
  const kept = keptPersonLines.map((line) => line.trim());
  const used = new Set<number>();
  return pending.filter((text) => {
    const at = kept.findIndex(
      (line, index) => !used.has(index) && line === text.trim(),
    );
    if (at === -1) return true;
    used.add(at);
    return false;
  });
}
