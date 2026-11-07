// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUiActIntentSchema, type QUiActIntent } from "@capital-q/contracts";

import {
  bindingOf,
  classOfAct,
  executeApproved,
  resetApprovals,
  type ApprovalAction,
  type ApprovalPayload,
} from "../src/features/q/control/approval";
import {
  approveRequest,
  heldReason,
  resetApprovalRequests,
  subscribeApprovals,
  type ApprovalRequest,
} from "../src/features/q/control/approval-requests";
import { QActPrompts } from "../src/features/q/control/q-act-prompts";
import { noticeOf } from "../src/features/q/control/q-control-runtime";
import {
  registerControl,
  resetControls,
} from "../src/features/q/control/registry";
import {
  performUiAct,
  resetUiActController,
} from "../src/features/q/ui-act-controller";

/**
 * W5.1 (Q Workspace plan §5, §7; DECISIONS 71): every page action has an
 * approval class, enforced in code at the one place Q's acts land
 * (performOnControl). The model's act carries no class. An APPROVAL
 * action never runs from an act -- only through the person's approval of
 * its exact payload, once per idempotency key. NEVER never runs.
 */

let n = 0;
const intent = (act: QUiActIntent["act"], target: string): QUiActIntent => {
  n += 1;
  return { kind: "UI_ACT", actId: `uia_pageact${String(n)}x`, act, target };
};

function button(id: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = id;
  document.body.append(element);
  return element;
}

beforeEach(() => {
  resetControls();
  resetUiActController();
  resetApprovals();
  resetApprovalRequests();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the class that governs an act", () => {
  it("is NONE for every view-only kind, whatever a page declares", () => {
    for (const kind of [
      "TAB",
      "SECTION",
      "LIST",
      "FILTER",
      "DISCLOSURE",
      "CAROUSEL",
      "DIALOG",
      "MENU",
    ] as const) {
      expect(classOfAct(kind, "APPROVAL", "OPEN")).toBe("NONE");
      expect(classOfAct(kind, undefined, "SELECT_TAB")).toBe("NONE");
    }
  });

  it("is NONE for bringing anything into view or focus, even a NEVER button", () => {
    expect(classOfAct("BUTTON", "NEVER", "SCROLL_TO")).toBe("NONE");
    expect(classOfAct("BUTTON", "APPROVAL", "FOCUS")).toBe("NONE");
  });

  it("is the page's declared class for a clickable kind, and refused when none is declared", () => {
    for (const kind of ["BUTTON", "TOGGLE", "INPUT", "LIST_ITEM"] as const) {
      expect(classOfAct(kind, undefined, "ACTIVATE")).toBeNull();
      expect(classOfAct(kind, "CONFIRM", "ACTIVATE")).toBe("CONFIRM");
      expect(classOfAct(kind, "APPROVAL", "SET")).toBe("APPROVAL");
    }
  });

  it("cannot come from the model: an act carrying a class is not a valid act", () => {
    expect(
      QUiActIntentSchema.safeParse({
        ...intent("ACTIVATE", "button.send"),
        approval: "NONE",
      }).success,
    ).toBe(false);
  });
});

describe("acts on the page, by class", () => {
  it("NONE: Q does it", async () => {
    const onAct = vi.fn(() => "DONE" as const);
    const element = button("open");
    registerControl({
      id: "button.open-filters",
      kind: "BUTTON",
      element: () => element,
      onAct,
      exclusive: true,
      approval: "NONE",
    });
    const receipt = await performUiAct(
      intent("ACTIVATE", "button.open-filters"),
    );
    expect(receipt.status).toBe("DONE");
    expect(onAct).toHaveBeenCalledTimes(1);
  });

  it("unclassified: a button with no class is never operated by Q", async () => {
    const onAct = vi.fn(() => "DONE" as const);
    const click = vi.fn();
    const element = button("mystery");
    element.addEventListener("click", click);
    registerControl({
      id: "button.mystery",
      kind: "BUTTON",
      element: () => element,
      onAct,
    });
    const step = intent("ACTIVATE", "button.mystery");
    const receipt = await performUiAct(step);
    expect(receipt.status).toBe("NOT_APPLICABLE");
    expect(onAct).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(heldReason(step.actId)).toBe("UNCLASSIFIED");
  });

  it("CONFIRM: runs only after the person's own tap, and not at all when they decline", async () => {
    render(<QActPrompts />);
    const onAct = vi.fn(() => "DONE" as const);
    const element = button("save");
    registerControl({
      id: "button.save-company",
      kind: "BUTTON",
      element: () => element,
      onAct,
      exclusive: true,
      approval: "CONFIRM",
      confirmSummary: () => "Save Brightwell to your list",
    });
    const asked = performUiAct(intent("ACTIVATE", "button.save-company"));
    await screen.findByText("Save Brightwell to your list");
    expect(onAct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect((await asked).status).toBe("DONE");
    expect(onAct).toHaveBeenCalledTimes(1);

    const declined = performUiAct(intent("ACTIVATE", "button.save-company"));
    await screen.findByText("Save Brightwell to your list");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect((await declined).status).toBe("NOT_APPLICABLE");
    expect(onAct).toHaveBeenCalledTimes(1);
  });

  it("NEVER: moving money is never run, approved or not", async () => {
    const execute = vi.fn(() => Promise.resolve("DONE" as const));
    const transfer: ApprovalAction = {
      id: "button.transfer-funds",
      summary: () => "Transfer $2,000,000 to Ledgerfold",
      prepare: () => ({ amount: "2000000", currency: "USD", to: "Ledgerfold" }),
      execute,
    };
    const element = button("transfer");
    registerControl({
      id: "button.transfer-funds",
      kind: "BUTTON",
      element: () => element,
      approval: "NEVER",
      action: transfer,
    });
    const step = intent("ACTIVATE", "button.transfer-funds");
    expect((await performUiAct(step)).status).toBe("NOT_APPLICABLE");
    expect(heldReason(step.actId)).toBe("NEVER");
    const payload = transfer.prepare();
    expect(payload).not.toBeNull();
    const outcome = await executeApproved(transfer, "NEVER", {
      actionId: transfer.id,
      binding: bindingOf(payload ?? {}),
      idempotencyKey: "apr-test-never",
    });
    expect(outcome).toEqual({
      status: "REFUSED",
      reason: "NOT_APPROVAL_CLASS",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(
      noticeOf({
        intent: step,
        receipt: { actId: step.actId, status: "NOT_APPLICABLE" },
      }),
    ).toMatch(/never does that/u);
  });
});

describe("APPROVAL: prepared, approved on its exact payload, run once", () => {
  function sendMessage(draft: { text: string }) {
    const execute = vi.fn<ApprovalAction["execute"]>(() =>
      Promise.resolve("DONE"),
    );
    const action: ApprovalAction = {
      id: "button.send-message",
      summary: (payload) => `Send this message to ${String(payload["to"])}`,
      prepare: (): ApprovalPayload | null =>
        draft.text.trim().length === 0
          ? null
          : { to: "Brightwell", text: draft.text },
      execute,
    };
    const element = button("send");
    const click = vi.fn();
    element.addEventListener("click", click);
    registerControl({
      id: action.id,
      kind: "BUTTON",
      element: () => element,
      approval: "APPROVAL",
      action,
    });
    return { action, execute, click };
  }

  it("never runs from Q's act: the act prepares it for approval and runs nothing", async () => {
    const draft = { text: "Thanks, Tuesday works." };
    const { execute, click } = sendMessage(draft);
    let pending: readonly ApprovalRequest[] = [];
    subscribeApprovals((requests) => {
      pending = requests;
    });
    const step = intent("ACTIVATE", "button.send-message");
    const receipt = await performUiAct(step);
    expect(receipt.status).toBe("NOT_APPLICABLE");
    expect(execute).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(heldReason(step.actId)).toBe("AWAITING_APPROVAL");
    // The exact payload is what the person sees.
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload).toEqual({
      to: "Brightwell",
      text: "Thanks, Tuesday works.",
    });
    // No notice over the approval card.
    expect(
      noticeOf({
        intent: step,
        receipt: { actId: step.actId, status: "NOT_APPLICABLE" },
      }),
    ).toBeNull();
  });

  it("negative: cannot run without a bound approval, for another action, or on an edited payload", async () => {
    const draft = { text: "Thanks, Tuesday works." };
    const { action, execute } = sendMessage(draft);
    expect(await executeApproved(action, "APPROVAL", null)).toEqual({
      status: "REFUSED",
      reason: "NO_APPROVAL",
    });
    const binding = bindingOf({ to: "Brightwell", text: draft.text });
    expect(
      await executeApproved(action, "APPROVAL", {
        actionId: "button.accept-intro",
        binding,
        idempotencyKey: "apr-test-other",
      }),
    ).toEqual({ status: "REFUSED", reason: "WRONG_ACTION" });
    // Approved, then the draft changed: the new text was never approved.
    draft.text = "Actually, let's meet Friday and bring the term sheet.";
    expect(
      await executeApproved(action, "APPROVAL", {
        actionId: action.id,
        binding,
        idempotencyKey: "apr-test-edited",
      }),
    ).toEqual({ status: "REFUSED", reason: "PAYLOAD_CHANGED" });
    // A class other than APPROVAL is never run this way either.
    expect(
      await executeApproved(action, "CONFIRM", {
        actionId: action.id,
        binding: bindingOf({ to: "Brightwell", text: draft.text }),
        idempotencyKey: "apr-test-class",
      }),
    ).toEqual({ status: "REFUSED", reason: "NOT_APPROVAL_CLASS" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs once on the person's approval of what they saw; the same approval again runs nothing", async () => {
    const draft = { text: "Thanks, Tuesday works." };
    const { action, execute } = sendMessage(draft);
    let pending: readonly ApprovalRequest[] = [];
    subscribeApprovals((requests) => {
      pending = requests;
    });
    await performUiAct(intent("ACTIVATE", "button.send-message"));
    const request = pending[0];
    expect(request).toBeDefined();
    if (request === undefined) return;
    expect(await approveRequest(request.id)).toEqual({
      status: "DONE",
      repeated: false,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      { to: "Brightwell", text: "Thanks, Tuesday works." },
      request.id,
    );
    // Idempotency: the same key (a double tap, a retried request).
    expect(
      await executeApproved(action, "APPROVAL", {
        actionId: action.id,
        binding: request.binding,
        idempotencyKey: request.id,
      }),
    ).toEqual({ status: "DONE", repeated: true });
    expect(execute).toHaveBeenCalledTimes(1);
    // Bindings are canonical: the same payload in another key order binds.
    expect(bindingOf({ text: "a", to: "b" })).toBe(
      bindingOf({ to: "b", text: "a" }),
    );
  });

  it("the person approves on screen, seeing the exact payload", async () => {
    render(<QActPrompts />);
    const { execute } = sendMessage({ text: "Thanks, Tuesday works." });
    await act(async () => {
      await performUiAct(intent("ACTIVATE", "button.send-message"));
    });
    expect(screen.getByText("Send this message to Brightwell")).toBeTruthy();
    expect(screen.getByText("Thanks, Tuesday works.")).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await Promise.resolve();
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("every clickable control the app registers declares its class", () => {
  it("has an approval class on every button, toggle, input and list item registration", () => {
    // jsdom gives import.meta.url another scheme: resolve from the run's root.
    const root = existsSync(join(process.cwd(), "apps/web/src"))
      ? join(process.cwd(), "apps/web/src")
      : join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/u.test(name)) files.push(path);
      }
    };
    walk(root);
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const calls = source.matchAll(
        /useQControl(?:Group)?\(\{([\s\S]*?)\n\s*\}\);/gu,
      );
      for (const call of calls) {
        const body = call[1] ?? "";
        if (!/kind: "(BUTTON|TOGGLE|INPUT|LIST_ITEM)"/u.test(body)) continue;
        if (!/\bapproval: "(NONE|CONFIRM|APPROVAL|NEVER)"/u.test(body)) {
          missing.push(file.slice(root.length));
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
