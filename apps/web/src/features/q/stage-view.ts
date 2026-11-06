/**
 * Which view of the one Q conversation the person chose (owner
 * 2026-11-06): Chat, the default, or Q, the voice view. Per viewer, kept
 * across visits. Its own module so the wake word can show the voice view
 * before it talks, without loading the conversation panel.
 */

export type QStageView = "presence" | "chat";
const STAGE_VIEW_KEY = "cq.q.view";
const STAGE_VIEW_EVENT = "cq:q-view";

export function subscribeStageView(onChange: () => void): () => void {
  window.addEventListener(STAGE_VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(STAGE_VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

let stageViewInMemory: QStageView | null = null;

export function writeStageView(next: QStageView): void {
  try {
    localStorage.setItem(STAGE_VIEW_KEY, next);
    stageViewInMemory = null;
  } catch {
    // Private mode: the choice lasts for this page only.
    stageViewInMemory = next;
  }
  window.dispatchEvent(new Event(STAGE_VIEW_EVENT));
}

export function readStageView(): QStageView {
  try {
    const stored = localStorage.getItem(STAGE_VIEW_KEY);
    if (stored === "chat" || stored === "presence") return stored;
  } catch {
    // Storage unavailable: fall through to this page's own choice.
  }
  // Owner 2026-11-06 (extending 2026-10-28's phone rule to every width):
  // everyone without a stored choice opens on Chat; Q is one tap away.
  return stageViewInMemory ?? "chat";
}

/** A line is starting: show the voice view first (voice means Q view). */
export function showQVoiceView(): void {
  writeStageView("presence");
}
