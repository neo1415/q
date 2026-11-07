// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EDITING_ATTRIBUTE,
  LEAVE_QUESTION,
  dirtyFormsNow,
  resetDirtyForms,
  watchDirtyForms,
} from "@/features/workspace/dirty-forms";
import { hasDirtyWork } from "@/features/workspace/workspace-screen";

/**
 * W5.4: unsaved work on editing pages is known to Q's navigation policy
 * (hasDirtyWork) and guards the person's own leaving.
 */

function page(): {
  readonly form: HTMLFormElement;
  readonly field: HTMLInputElement;
  readonly search: HTMLInputElement;
  readonly link: HTMLAnchorElement;
} {
  document.body.innerHTML = `
    <form ${EDITING_ATTRIBUTE}><input name="thesis" /><a href="/help" id="help">help</a></form>
    <form role="search"><input name="q" /></form>
    <a href="/discover" id="away">Discover</a>`;
  const [form, searchForm] = Array.from(document.querySelectorAll("form"));
  if (form === undefined || searchForm === undefined)
    throw new Error("no form");
  const field = form.querySelector("input");
  const search = searchForm.querySelector("input");
  const link = document.querySelector<HTMLAnchorElement>("#away");
  if (field === null || search === null || link === null) {
    throw new Error("no fields");
  }
  return { form, field, search, link };
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(target: Element): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  target.dispatchEvent(event);
  return event;
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  resetDirtyForms();
  document.body.innerHTML = "";
});

describe("W5.4 dirty forms", () => {
  it("marks an editing form dirty on input and Q's policy sees it", () => {
    const { field } = page();
    stop = watchDirtyForms(document, { ask: () => true });
    expect(dirtyFormsNow()).toBe(false);
    expect(hasDirtyWork()).toBe(false);
    type(field, "Seed fintech in West Africa");
    expect(dirtyFormsNow()).toBe(true);
    expect(hasDirtyWork()).toBe(true);
  });

  it("does not count a search or filter form as work to lose", () => {
    const { search } = page();
    stop = watchDirtyForms(document, { ask: () => true });
    type(search, "brightwell");
    expect(dirtyFormsNow()).toBe(false);
  });

  it("clears on submit, on reset, and when the form leaves the page", () => {
    const { form, field } = page();
    stop = watchDirtyForms(document, { ask: () => true });
    type(field, "a");
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(dirtyFormsNow()).toBe(false);
    type(field, "b");
    form.dispatchEvent(new Event("reset", { bubbles: true }));
    expect(dirtyFormsNow()).toBe(false);
    type(field, "c");
    form.remove();
    expect(dirtyFormsNow()).toBe(false);
  });

  it("asks before an in-app link leaves unsaved work; stay blocks it", () => {
    const { field, link } = page();
    const ask = vi.fn(() => false);
    stop = watchDirtyForms(document, { ask });
    type(field, "draft");
    const event = click(link);
    expect(ask).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(event.defaultPrevented).toBe(true);
    expect(dirtyFormsNow()).toBe(true); // the work is still there
  });

  it("lets the person leave when they choose to, and forgets the draft", () => {
    const { field, link } = page();
    stop = watchDirtyForms(document, { ask: () => true });
    type(field, "draft");
    expect(click(link).defaultPrevented).toBe(false);
    expect(dirtyFormsNow()).toBe(false);
  });

  it("never asks with nothing unsaved, nor for a link inside the form", () => {
    const { field, link } = page();
    const ask = vi.fn(() => false);
    stop = watchDirtyForms(document, { ask });
    expect(click(link).defaultPrevented).toBe(false);
    type(field, "draft");
    const help = document.querySelector("#help");
    if (help === null) throw new Error("no help link");
    expect(click(help).defaultPrevented).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks for pages' own unsaved work too (useDirty), and on a new-tab click not at all", () => {
    const { link } = page();
    const ask = vi.fn(() => false);
    stop = watchDirtyForms(document, { ask, alsoDirty: () => true });
    const newTab = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    link.dispatchEvent(newTab);
    expect(ask).not.toHaveBeenCalled();
    expect(click(link).defaultPrevented).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("guards a reload or closing the tab while work is unsaved", () => {
    const { field } = page();
    stop = watchDirtyForms(document, { ask: () => true });
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    type(field, "draft");
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });
});

/** Every form on an editing page says so (source scan). */
const SRC = existsSync(join(process.cwd(), "apps/web/src"))
  ? join(process.cwd(), "apps/web/src")
  : join(process.cwd(), "src");
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * Forms that are not work to lose: search, filters, sign-in and sign-out,
 * one-tap requests, questions to Q, and the work composer (it keeps its
 * own task). Anything else must carry data-q-editing or useDirty.
 */
const NOT_EDITING = new Set(
  [
    "features/admin/search-form.tsx",
    "features/auth/components/forgot-password-form.tsx",
    "features/auth/components/google-sign-in.tsx",
    "features/auth/components/sign-in-form.tsx",
    "features/auth/components/sign-out-button.tsx",
    "features/auth/components/sign-up-form.tsx",
    "features/auth/components/two-step-form.tsx",
    "features/auth/components/update-password-form.tsx",
    "features/board/work-board.tsx",
    "features/briefing/arrival-briefing.tsx",
    "features/discover/filters/discover-filter-controls.tsx",
    "features/documents/document-library.tsx",
    "features/explore/explore-search-results.tsx",
    "features/gateq/page/founder-views.tsx",
    "features/gateq/page/inbox-view.tsx",
    "features/gateq/page/investor-views.tsx",
    "features/organisation/activity-feed.tsx",
    "features/profile/verification-section.tsx",
    "features/q-card/q-card-panel.tsx",
    "features/relationships/ask-q-relationship.tsx",
    "features/relationships/pipeline-toolbar.tsx",
    "features/rehearsal/rehearsal-room.tsx",
    "features/schedule/join-call-form.tsx",
    "features/verification/verification-standings.tsx",
    "features/voice/voice-stage.tsx",
    "features/work/work-page.tsx",
  ].map((path) => join(SRC, path)),
);

describe("W5.4 editing pages are marked", () => {
  it("every form outside the known non-editing set carries data-q-editing", () => {
    const unmarked: string[] = [];
    for (const file of tsxFiles(SRC)) {
      if (NOT_EDITING.has(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<form\b[^>]*>/g)) {
        if (!match[0].includes(EDITING_ATTRIBUTE)) unmarked.push(file);
      }
    }
    expect(unmarked).toEqual([]);
  });

  it("the known editors without a form register their unsaved work", () => {
    for (const path of [
      "features/integrations/email-draft-editor.tsx",
      "features/integrations/chat-draft-editor.tsx",
      "features/pitch/pitch-details.tsx",
      "features/profile/answer-editor.tsx",
      "features/schedule/relationship-schedule-controls.tsx",
      "features/q-card/q-card-panel.tsx",
    ]) {
      expect(readFileSync(join(SRC, path), "utf8")).toMatch(/useDirty\(/);
    }
  });
});
