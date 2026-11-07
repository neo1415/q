/**
 * W5.4 (Q Workspace plan §5; W4.2 leave guard): unsaved work on editing
 * pages -- the mandate, profile and pitch editors, the capital and
 * commitment forms, notes, messages being written, onboarding answers.
 *
 * An editing form says so with `data-q-editing`; search and filter forms
 * do not (typing a search is not work to lose). One watcher, started by
 * the shell, follows the person's own input:
 * - input or change inside an editing form marks it dirty;
 * - its submit or reset clears it, and so does the form leaving the page;
 * - while any is dirty, `dirtyFormsNow()` is true: Q's navigation policy
 *   offers instead of moving (workspace-screen.ts hasDirtyWork), and the
 *   person's own leaving asks first (an in-app link, a reload, closing).
 * Pages with editors that are not forms register with `useDirty`.
 */

export const EDITING_ATTRIBUTE = "data-q-editing";

/** What the person is asked before leaving unsaved work. */
export const LEAVE_QUESTION =
  "You have changes that aren't saved. Leave this page anyway?";

const dirty = new Set<HTMLFormElement>();

function editingFormOf(target: EventTarget | null): HTMLFormElement | null {
  if (!(target instanceof Element)) return null;
  const form = target.closest("form");
  return form !== null && form.hasAttribute(EDITING_ATTRIBUTE) ? form : null;
}

/** Whether any editing form on the page holds unsaved input now. */
export function dirtyFormsNow(): boolean {
  for (const form of dirty) {
    if (!form.isConnected) dirty.delete(form);
  }
  return dirty.size > 0;
}

/** Clears every mark (tests). */
export function resetDirtyForms(): void {
  dirty.clear();
}

/**
 * Starts following input on `root` (the document). Returns
 * the stop. `ask` is the leave question (window.confirm in the browser).
 */
export function watchDirtyForms(
  root: Document,
  options: {
    /** Extra unsaved work registered by pages (useDirty). */
    readonly alsoDirty?: () => boolean;
    readonly ask?: (question: string) => boolean;
  } = {},
): () => void {
  const view = root.defaultView;
  const ask =
    options.ask ?? ((question: string) => view?.confirm(question) ?? true);
  const anyDirty = () => dirtyFormsNow() || (options.alsoDirty?.() ?? false);

  const onInput = (event: Event) => {
    // Typed by the person or filled for them by Q (a control act): either
    // way it is a draft they would lose by moving away.
    const form = editingFormOf(event.target);
    if (form !== null) dirty.add(form);
  };
  const onDone = (event: Event) => {
    if (event.target instanceof HTMLFormElement) dirty.delete(event.target);
  };
  // The person's own move away: an in-app link pressed while work is
  // unsaved asks first; "stay" keeps them, and their work, where it is.
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return; // a new tab or window leaves nothing behind
    }
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.target !== "" && link.target !== "_self") return;
    if (link.hasAttribute("download")) return;
    // A link inside the form being edited (a help link) is not leaving it.
    const inside = editingFormOf(link);
    if (inside !== null && dirty.has(inside)) return;
    if (!anyDirty()) return;
    if (!ask(LEAVE_QUESTION)) {
      event.preventDefault();
      event.stopPropagation();
    } else {
      dirty.clear();
    }
  };
  // A reload or closing the tab: the browser's own question.
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!anyDirty()) return;
    event.preventDefault();
    // Older browsers need a value to show their question.
    event.returnValue = "";
  };

  root.addEventListener("input", onInput, true);
  root.addEventListener("change", onInput, true);
  root.addEventListener("submit", onDone, true);
  root.addEventListener("reset", onDone, true);
  root.addEventListener("click", onClick, true);
  view?.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    root.removeEventListener("input", onInput, true);
    root.removeEventListener("change", onInput, true);
    root.removeEventListener("submit", onDone, true);
    root.removeEventListener("reset", onDone, true);
    root.removeEventListener("click", onClick, true);
    view?.removeEventListener("beforeunload", onBeforeUnload);
  };
}
