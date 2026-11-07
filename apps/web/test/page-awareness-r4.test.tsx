// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout: vi.fn(), askNow: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/company/c1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    replace: vi.fn(),
    refresh: () => undefined,
    push: vi.fn(),
  }),
}));
vi.mock("@/features/assumptions/assumption-actions", () => ({
  sendQuestionsAction: vi.fn(() =>
    Promise.resolve({ ok: true, value: { via: "CHAT_MESSAGE" } }),
  ),
}));

import { sendQuestionsAction } from "@/features/assumptions/assumption-actions";

import { BriefProvider } from "../src/features/company/brief/brief-context";
import {
  NextStepRibbon,
  questionsOf,
  questionsPayload,
} from "../src/features/company/brief/next-step";
import * as fixtures from "../src/features/company/material/review-fixtures";
import {
  controlOf,
  manifestControls,
  resetControls,
} from "../src/features/q/control/registry";

/**
 * R4 (owner live test 2026-11-07): on Spheros's page the next step was
 * "Send 3 questions to Kathryn Outlaw" [Review first] [Send questions].
 * Asked "send those questions to kathryn", Q drafted four of its own as a
 * message, then a request: two approvals, neither the page's. The page's
 * "Send questions" was never registered, so Q could not see it. It now is,
 * with the questions it would send, and runs through its own approval.
 */
afterEach(() => {
  cleanup();
  resetControls();
});

function page() {
  return render(
    <BriefProvider
      companyId="c1"
      companyName="Spheros"
      who="Kathryn Outlaw"
      route={{ kind: "CHAT", relationshipId: "r1" }}
      board={fixtures.reviewBoard()}
      qView={null}
    >
      <NextStepRibbon
        serverTab="overview"
        companyId="c1"
        companyName="Spheros"
        state="CONNECTED"
        connected
        met={false}
        dataRoom={null}
        nextCall={null}
        interest={null}
      />
    </BriefProvider>,
  );
}

describe("the page's own Send questions reaches Q (R4)", () => {
  it("is in the manifest as an APPROVAL action with the questions it would send", () => {
    page();
    const control = manifestControls().find(
      (one) => one.id === "button.send-questions",
    );
    expect(control?.kind).toBe("BUTTON");
    expect(control?.action?.approval).toBe("APPROVAL");
    expect(control?.action?.summary).toMatch(
      /^Send \d+ questions? to Kathryn Outlaw$/u,
    );
    expect(control?.action?.items?.length).toBeGreaterThan(0);
  });

  it("runs on the approved questions exactly, through the page's own send", async () => {
    page();
    const action = controlOf("button.send-questions")?.action;
    const payload = action?.prepare();
    if (action === undefined || payload === null || payload === undefined) {
      throw new Error("nothing prepared");
    }
    const approved = questionsOf(payload);
    expect(await action.execute(payload, "key-1")).toBe("DONE");
    expect(sendQuestionsAction).toHaveBeenCalledWith(
      expect.objectContaining({
        relationshipId: "r1",
        questions: approved,
        idempotencyKey: "key-1",
      }),
    );
  });

  it("the payload shows who and each question, and reads back the same", () => {
    const payload = questionsPayload("Kathryn Outlaw", ["One?", "Two?"]);
    expect(payload).toEqual({
      To: "Kathryn Outlaw",
      "Question 1": "One?",
      "Question 2": "Two?",
    });
    expect(questionsOf(payload)).toEqual(["One?", "Two?"]);
  });
});
