import { addBoardItemAction } from "./board-actions";

/**
 * The Q Board's pins, kept on the work board (owner 2026-10-23). Pins used
 * to live only in this tab; a pinned document now also becomes a DOCUMENT
 * item on the person's server board, once. The key is derived from the
 * document's id, so pinning it again, in any tab or conversation, adds
 * nothing twice (and never brings back an item they took off the board).
 *
 * Only documents carry a stable id and a title in a pin; a pinned company
 * list or note stays this tab's arrangement, as before.
 */

const KEPT_KEY = "cq.board.kept-pins";

function keptHere(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(KEPT_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((one): one is string => typeof one === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function remember(kept: Set<string>): void {
  try {
    window.sessionStorage.setItem(KEPT_KEY, JSON.stringify([...kept]));
  } catch {
    // Blocked storage: the server's key still makes a repeat a no-op.
  }
}

/** A UUID (RFC 4122 layout, version 5) from the document id. */
export async function pinKeyOf(artifactId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(`board-pin:${artifactId}`),
    ),
  );
  const hex = [...digest.slice(0, 16)]
    .map((byte, at) => {
      const value =
        at === 6
          ? (byte & 0x0f) | 0x50
          : at === 8
            ? (byte & 0x3f) | 0x80
            : byte;
      return value.toString(16).padStart(2, "0");
    })
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Keeps each pinned document on the work board, once per document. */
export async function keepPinnedDocuments(
  documents: readonly { readonly artifactId: string; readonly title: string }[],
): Promise<void> {
  const kept = keptHere();
  for (const document of documents) {
    if (kept.has(document.artifactId)) continue;
    const result = await addBoardItemAction({
      idempotencyKey: await pinKeyOf(document.artifactId),
      request: {
        kind: "DOCUMENT",
        refId: document.artifactId,
        title: document.title.slice(0, 300),
      },
    }).catch(() => null);
    if (result?.ok === true) {
      kept.add(document.artifactId);
      remember(kept);
    }
  }
}
