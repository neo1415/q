// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IncomingInterestDto, QUiActIntent } from "@capital-q/contracts";

/**
 * W5 evals (DECISIONS 72: examples are illustrations, not the test set).
 * Every consequential page action, driven the way Q drives it (a UI act
 * through the one controller), with curveballs meant to break it: an
 * empty or "@Q" draft, an edit after approval, the same approval twice,
 * an approval for one action used on another, a decline, an answered row,
 * a second row, an act that claims its own class. And one rule over the
 * whole site's source: any action whose name sends, shares, invites,
 * answers, commits, pays or signs is APPROVAL or NEVER, never less.
 */

const sendChatMessageAction = vi.fn();
vi.mock("../src/features/chat/chat-actions", () => ({
  chatAttachmentAction: vi.fn(),
  chatThreadAction: () => new Promise(() => undefined),
  markChatReadAction: () => Promise.resolve(),
  sendChatMessageAction: (...args: unknown[]) =>
    sendChatMessageAction(...args) as unknown,
  shareableDocumentsAction: () => new Promise(() => undefined),
  unsendChatMessageAction: vi.fn(),
}));
vi.mock("../src/features/chat/reply-draft-actions", () => ({
  startReplyDraftAction: vi.fn(),
  readReplyDraftAction: vi.fn(),
}));
vi.mock("../src/features/onboarding-kit/material-actions", () => ({
  materialUploadCompleteAction: vi.fn(),
  materialUploadTargetAction: vi.fn(),
}));

const findSlotsAction = vi.fn();
const bookMeetingAction = vi.fn();
const cancelMeetingAction = vi.fn();
vi.mock("../src/features/schedule/schedule-actions", () => ({
  findSlotsAction: (...args: unknown[]) => findSlotsAction(...args) as unknown,
  bookMeetingAction: (...args: unknown[]) =>
    bookMeetingAction(...args) as unknown,
  cancelMeetingAction: (...args: unknown[]) =>
    cancelMeetingAction(...args) as unknown,
  createReminderAction: vi.fn(),
  dismissReminderAction: vi.fn(),
  joinCallAction: vi.fn(),
}));

const { RelationshipScheduleControls } =
  await import("../src/features/schedule/relationship-schedule-controls");
const { RelationshipChat } =
  await import("../src/features/chat/relationship-chat");
const { IncomingInterest } =
  await import("../src/features/network/incoming-interest");
const { performUiAct, resetUiActController } =
  await import("../src/features/q/ui-act-controller");
const { resetControls } = await import("../src/features/q/control/registry");
const { resetApprovals } = await import("../src/features/q/control/approval");
const {
  approveRequest,
  declineRequest,
  heldReason,
  resetApprovalRequests,
  subscribeApprovals,
} = await import("../src/features/q/control/approval-requests");
type Request = Parameters<Parameters<typeof subscribeApprovals>[0]>[0][number];

let n = 0;
const activate = (target: string): QUiActIntent => {
  n += 1;
  return {
    kind: "UI_ACT",
    actId: `uia_evalact${String(n)}x`,
    act: "ACTIVATE",
    target,
  };
};

let requests: readonly Request[] = [];
let stopWatching: () => void = () => undefined;
beforeEach(() => {
  resetControls();
  resetUiActController();
  resetApprovals();
  resetApprovalRequests();
  sendChatMessageAction.mockReset();
  findSlotsAction.mockReset();
  bookMeetingAction.mockReset();
  cancelMeetingAction.mockReset();
  stopWatching = subscribeApprovals((next) => {
    requests = next;
  });
});
afterEach(() => {
  stopWatching();
  cleanup();
  document.body.innerHTML = "";
});

/** Q's act: it never runs the action, only prepares it (or is held). */
async function qActivates(target: string) {
  const intent = activate(target);
  const receipt = await act(() => performUiAct(intent));
  return { receipt, held: heldReason(intent.actId) };
}

describe("eval: Q sending a message in the relationship chat", () => {
  const RELATIONSHIP = "7a000000-0000-4000-8000-000000000002";
  const mount = () => {
    const view = render(
      <RelationshipChat
        relationshipId={RELATIONSHIP}
        counterpart="Brightwell Capital"
        initial={null}
      />,
    );
    const field =
      view.container.querySelector<HTMLTextAreaElement>("#chat-draft");
    if (field === null) throw new Error("no composer");
    const type = (text: string) =>
      act(() => {
        fireEvent.change(field, { target: { value: text } });
      });
    return { type };
  };

  it("an empty composer: nothing is prepared, nothing sent", async () => {
    mount();
    // Its Send is disabled: the act lands nowhere and prepares nothing.
    const { receipt } = await qActivates("button.chat-send");
    expect(receipt.status).not.toBe("DONE");
    expect(requests).toEqual([]);
    expect(sendChatMessageAction).not.toHaveBeenCalled();
  });

  it("'@Q …' is a question to Q, never a message Q may send", async () => {
    const { type } = mount();
    type("@Q what should I say?");
    const { held } = await qActivates("button.chat-send");
    expect(held).toBe("NOTHING_PREPARED");
    expect(sendChatMessageAction).not.toHaveBeenCalled();
  });

  it("Q's act sends nothing; the person sees the exact words and approves once", async () => {
    const { type } = mount();
    type("Happy to share the Q3 numbers on Thursday.");
    const { receipt, held } = await qActivates("button.chat-send");
    // Owner replay batch 7 (#9): prepared, waiting for approval.
    expect(receipt.status).toBe("AWAITING_APPROVAL");
    expect(held).toBe("AWAITING_APPROVAL");
    expect(sendChatMessageAction).not.toHaveBeenCalled();
    const [request] = requests;
    expect(request?.payload).toEqual({
      to: "Brightwell Capital",
      message: "Happy to share the Q3 numbers on Thursday.",
    });
    sendChatMessageAction.mockResolvedValue({
      ok: true,
      value: {
        messageId: "7c000000-0000-4000-8000-000000000001",
        side: "INVESTOR",
        mine: true,
        senderName: "You",
        kind: "TEXT",
        body: "Happy to share the Q3 numbers on Thursday.",
        attachment: null,
        voiceDurationMs: null,
        edited: false,
        unsent: false,
        sentAt: "2026-11-07T09:00:00.000Z",
      },
    });
    const id = request?.id ?? "";
    const first = await act(() => approveRequest(id));
    expect(first).toMatchObject({ status: "DONE", repeated: false });
    expect(sendChatMessageAction).toHaveBeenCalledTimes(1);
    expect(sendChatMessageAction).toHaveBeenCalledWith(
      RELATIONSHIP,
      { kind: "TEXT", body: "Happy to share the Q3 numbers on Thursday." },
      id,
    );
  });

  it("an edit after Q prepared it is not what was approved: nothing is sent", async () => {
    const { type } = mount();
    type("We can do $2M.");
    await qActivates("button.chat-send");
    type("We can do $20M.");
    const outcome = await act(() => approveRequest(requests[0]?.id ?? ""));
    expect(outcome).toMatchObject({
      status: "REFUSED",
      reason: "PAYLOAD_CHANGED",
    });
    expect(sendChatMessageAction).not.toHaveBeenCalled();
  });

  it("'not now' sends nothing, and the request is gone", async () => {
    const { type } = mount();
    type("See you Thursday.");
    await qActivates("button.chat-send");
    act(() => declineRequest(requests[0]?.id ?? ""));
    expect(requests).toEqual([]);
    expect(sendChatMessageAction).not.toHaveBeenCalled();
  });
});

const interest = (
  id: string,
  name: string,
  response: IncomingInterestDto["response"] = "PENDING",
): IncomingInterestDto => ({
  interestId: id,
  investorOrganisationId: id.replace(/^7d/u, "7e"),
  investorName: name,
  investorType: "VC",
  expressedAt: "2026-11-05T10:00:00.000Z",
  note: null,
  response,
  respondedAt: response === "PENDING" ? null : "2026-11-06T10:00:00.000Z",
  connection: null,
});
const A = "7d000000-0000-4000-8000-000000000001";
const B = "7d000000-0000-4000-8000-000000000002";

describe("eval: Q answering an investor's interest", () => {
  it("accept: prepared for approval naming the investor; runs once on approval", async () => {
    const answer = vi.fn(
      (input: { interestId: string; decision: "ACCEPTED" | "DECLINED" }) =>
        Promise.resolve({
          ok: true as const,
          value: {
            interest: interest(
              input.interestId,
              "Apex Ventures",
              input.decision,
            ),
            deduplicated: false,
          },
        }),
    );
    render(
      <IncomingInterest
        items={[interest(A, "Apex Ventures"), interest(B, "Kestrel")]}
        answer={answer}
      />,
    );
    const { held } = await qActivates("button.interest-accept");
    expect(held).toBe("AWAITING_APPROVAL");
    expect(answer).not.toHaveBeenCalled();
    // The top unanswered row: Apex, not Kestrel.
    expect(requests[0]?.payload).toEqual({
      investor: "Apex Ventures",
      answer: "Accept",
    });
    const id = requests[0]?.id ?? "";
    await act(() => approveRequest(id));
    await act(() => approveRequest(id));
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0]?.[0]).toMatchObject({
      interestId: A,
      decision: "ACCEPTED",
    });
  });

  it("an answered row is skipped: Q's decline targets the next one", async () => {
    const answer = vi.fn();
    render(
      <IncomingInterest
        items={[
          interest(A, "Apex Ventures", "ACCEPTED"),
          interest(B, "Kestrel"),
        ]}
        answer={answer}
      />,
    );
    await qActivates("button.interest-decline");
    expect(requests[0]?.payload).toEqual({
      investor: "Kestrel",
      answer: "Decline",
    });
    expect(answer).not.toHaveBeenCalled();
  });

  it("nothing left to answer: there is no accept for Q to press", async () => {
    render(
      <IncomingInterest
        items={[interest(A, "Apex Ventures", "DECLINED")]}
        answer={vi.fn()}
      />,
    );
    const { receipt } = await qActivates("button.interest-accept");
    expect(receipt.status).toBe("TARGET_MISSING");
    expect(requests).toEqual([]);
  });

  it("an approval for accept cannot be spent on decline", async () => {
    const answer = vi.fn();
    render(<IncomingInterest items={[interest(A, "Apex")]} answer={answer} />);
    await qActivates("button.interest-accept");
    await qActivates("button.interest-decline");
    expect(requests.map((one) => one.actionId)).toEqual([
      "button.interest-accept",
      "button.interest-decline",
    ]);
    // Each request carries its own action and payload; approving neither
    // runs anything.
    expect(requests[0]?.payload["answer"]).toBe("Accept");
    expect(requests[1]?.payload["answer"]).toBe("Decline");
    expect(answer).not.toHaveBeenCalled();
  });
});

describe("eval: Q finding a time and sending the invite", () => {
  const RELATIONSHIP = "7a000000-0000-4000-8000-000000000003";
  const SLOT = {
    startsAt: "2026-11-10T09:00:00.000Z",
    endsAt: "2026-11-10T09:30:00.000Z",
  };
  const meeting = (id: string, organisedByYou: boolean) => ({
    id,
    relationshipId: RELATIONSHIP,
    purpose: "Intro call",
    startsAt: "2099-11-12T09:00:00.000Z",
    endsAt: "2099-11-12T09:30:00.000Z",
    timeZone: "UTC",
    status: "SCHEDULED" as const,
    organisedByYou,
    organiserName: organisedByYou ? "You" : "Brightwell",
    meetLink: null,
    attendees: [],
    hasBrief: false,
  });

  it("finding times is NONE; the invite is APPROVAL on the exact time, sent once", async () => {
    findSlotsAction.mockResolvedValue({ ok: true, value: { slots: [SLOT] } });
    bookMeetingAction.mockResolvedValue({
      ok: true,
      value: { ...meeting("7f000000-0000-4000-8000-000000000001", true) },
    });
    await act(async () => {
      render(
        <RelationshipScheduleControls
          focus="call"
          relationshipId={RELATIONSHIP}
          counterpart="Brightwell"
          connected
          initialMeetings={[]}
          initialReminders={[]}
        />,
      );
      await Promise.resolve();
    });
    expect(findSlotsAction).toHaveBeenCalled();
    const { held } = await qActivates("button.meeting-book");
    expect(held).toBe("AWAITING_APPROVAL");
    expect(bookMeetingAction).not.toHaveBeenCalled();
    expect(requests[0]?.payload).toMatchObject({
      with: "Brightwell",
      startsAt: SLOT.startsAt,
      topic: "Call with Brightwell",
    });
    const id = requests[0]?.id ?? "";
    await act(() => approveRequest(id));
    await act(() => approveRequest(id));
    expect(bookMeetingAction).toHaveBeenCalledTimes(1);
    expect(bookMeetingAction.mock.calls[0]?.[0]).toMatchObject({
      startsAt: SLOT.startsAt,
      idempotencyKey: id,
    });
  });

  it("cancel targets only a call the person organised, never one they were invited to", async () => {
    findSlotsAction.mockResolvedValue({ ok: true, value: { slots: [] } });
    render(
      <RelationshipScheduleControls
        relationshipId={RELATIONSHIP}
        counterpart="Brightwell"
        connected
        initialMeetings={[
          meeting("7f000000-0000-4000-8000-000000000002", false),
        ]}
        initialReminders={[]}
      />,
    );
    const { receipt } = await qActivates("button.meeting-cancel");
    expect(receipt.status).not.toBe("DONE");
    expect(requests).toEqual([]);
    expect(cancelMeetingAction).not.toHaveBeenCalled();
  });

  it("cancelling their own call is prepared for approval, never run by the act", async () => {
    render(
      <RelationshipScheduleControls
        relationshipId={RELATIONSHIP}
        counterpart="Brightwell"
        connected
        initialMeetings={[
          meeting("7f000000-0000-4000-8000-000000000003", true),
        ]}
        initialReminders={[]}
      />,
    );
    const { held } = await qActivates("button.meeting-cancel");
    expect(held).toBe("AWAITING_APPROVAL");
    expect(requests[0]?.payload["meeting"]).toBe(
      "7f000000-0000-4000-8000-000000000003",
    );
    expect(cancelMeetingAction).not.toHaveBeenCalled();
  });
});

describe("eval: an act cannot claim its own class", () => {
  it("an act carrying approval: NONE is not a valid act at all", async () => {
    const { QUiActIntentSchema } = await import("@capital-q/contracts");
    expect(
      QUiActIntentSchema.safeParse({
        ...activate("button.chat-send"),
        approval: "NONE",
      }).success,
    ).toBe(false);
  });
});

/** The site-wide rule over every registration in source. */
const SRC = existsSync(join(process.cwd(), "apps/web/src"))
  ? join(process.cwd(), "apps/web/src")
  : join(process.cwd(), "src");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/u.test(name) ? [path] : [];
  });
}
const CONSEQUENTIAL =
  /(send|share|invite|accept|decline|commit|record|confirm|withdraw|adopt|pay|transfer|sign|revoke|publish|delete|book|cancel|pass|ask|close)/u;

describe("eval: every consequential action on every page", () => {
  const registrations: { id: string; approval: string | null }[] = [];
  for (const file of sources(SRC)) {
    if (file.includes(`${join("features", "q", "control")}`)) continue;
    const source = readFileSync(file, "utf8");
    for (const call of source.matchAll(
      /useQControl\(\{([\s\S]*?)\n\s*\}\);/gu,
    )) {
      const body = call[1] ?? "";
      const id = /\bid: "([a-z]+\.[a-z0-9-]+)"/u.exec(body)?.[1];
      if (id === undefined) continue;
      const approval =
        /\bapproval: "(NONE|CONFIRM|APPROVAL|NEVER)"/u.exec(body)?.[1] ?? null;
      registrations.push({ id, approval });
    }
    for (const tag of source.matchAll(/<QControl\b([^>]*?)>/gsu)) {
      const attrs = tag[1] ?? "";
      const id = /\bid="([a-z]+\.[a-z0-9-]+)"/u.exec(attrs)?.[1];
      if (id === undefined) continue;
      const approval =
        /\bapproval="(NONE|CONFIRM|APPROVAL|NEVER)"/u.exec(attrs)?.[1] ?? null;
      registrations.push({ id, approval });
    }
  }

  it("signing and closing a deal are NEVER Q's", () => {
    for (const id of ["button.deal-signed", "button.deal-close"]) {
      expect(registrations.find((one) => one.id === id)?.approval, id).toBe(
        "NEVER",
      );
    }
  });

  it("finds the page actions", () => {
    expect(registrations.length).toBeGreaterThan(5);
  });

  it("is APPROVAL or NEVER whenever its name sends, shares, invites, answers, commits, pays or signs", () => {
    const weak = registrations.filter(
      (one) =>
        // "-open" only opens the form the person (or Q's approval) acts in.
        !one.id.endsWith("-open") &&
        // View kinds (sections, tabs, lists) are NONE by nature.
        /^(button|toggle|input|item)\./u.test(one.id) &&
        CONSEQUENTIAL.test(one.id.split(".")[1] ?? "") &&
        one.approval !== "APPROVAL" &&
        one.approval !== "NEVER",
    );
    expect(weak).toEqual([]);
  });

  it("covers the outward actions W5 names", () => {
    const approval = new Set(
      registrations
        .filter((one) => one.approval === "APPROVAL")
        .map((one) => one.id),
    );
    for (const id of [
      "button.chat-send",
      "button.interest-accept",
      "button.interest-decline",
      "button.dataroom-share",
      "button.team-invite",
      "button.commitment-record",
      "button.commitment-confirm",
      "button.commitment-withdraw",
      "button.commitment-adopt",
      "button.meeting-book",
      "button.meeting-cancel",
      "button.diligence-ask",
      "button.relationship-pass",
    ]) {
      expect(approval.has(id), id).toBe(true);
    }
  });
});
