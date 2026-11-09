import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner report (9 Nov, conversation with Zino Aviation): "Draft a reply"
 * filled the composer with Q's whole turn -- 'Message Zino Aviation: "Hi,
 * …". Ready to send: approve on the card, or tell me what to change.' --
 * or never finished, because Q prepared the message for approval and the
 * run waited on it. The draft is only the message body.
 */
const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const APPROVAL = "123e4567-e89b-12d3-a456-426614174001";
const BODY = "Hi, apologies for the slow reply.\n\nBest, Amara";

const readRun = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const pending = vi.fn<() => Promise<unknown>>();
const readApproval = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reject = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/features/q/actions", () => ({
  askQAction: vi.fn(),
  readQRunAction: (...args: unknown[]) => readRun(...args),
  pendingQApprovalsAction: () => pending(),
  readQApprovalAction: (...args: unknown[]) => readApproval(...args),
  rejectQApprovalAction: (...args: unknown[]) => reject(...args),
}));

const { readReplyDraftAction } =
  await import("../src/features/chat/reply-draft-actions");

function run(status: string, text?: string) {
  return {
    ok: true,
    value: {
      runId: RUN,
      status,
      messages:
        text === undefined ? [] : [{ role: "Q", text, messageId: "m1" }],
    },
  };
}

function preparedMessage(preview: string) {
  pending.mockResolvedValue({
    ok: true,
    value: [{ approvalId: APPROVAL, runId: RUN }],
  });
  readApproval.mockResolvedValue({
    ok: true,
    value: { action: { actionType: "chat.message.send", preview } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pending.mockResolvedValue({ ok: true, value: [] });
  reject.mockResolvedValue({ ok: true, value: null });
});

describe("Draft a reply reads only the message body", () => {
  it("takes the body Q prepared for approval, and declines Q's copy", async () => {
    readRun.mockResolvedValue(run("AWAITING_APPROVAL"));
    preparedMessage(BODY);
    const result = await readReplyDraftAction(RUN);
    expect(result).toEqual({ ok: true, value: { done: true, text: BODY } });
    // The person sends from the composer; no card waits to send the old words.
    expect(reject).toHaveBeenCalledWith(APPROVAL);
  });

  it("drops the note that a document is shared from the body", async () => {
    readRun.mockResolvedValue(run("AWAITING_APPROVAL"));
    preparedMessage(`${BODY}\n\n(shares one of your documents)`);
    const result = await readReplyDraftAction(RUN);
    expect(result).toEqual({ ok: true, value: { done: true, text: BODY } });
  });

  it("unwraps Q's 'Ready to send' turn to the quoted message", async () => {
    readRun.mockResolvedValue(
      run(
        "COMPLETED",
        `Message Zino Aviation: "${BODY}". Ready to send: approve on the card, or tell me what to change.`,
      ),
    );
    const result = await readReplyDraftAction(RUN);
    expect(result).toEqual({ ok: true, value: { done: true, text: BODY } });
  });

  it("keeps a plain answer as it is", async () => {
    readRun.mockResolvedValue(run("COMPLETED", BODY));
    const result = await readReplyDraftAction(RUN);
    expect(result).toEqual({ ok: true, value: { done: true, text: BODY } });
    expect(reject).not.toHaveBeenCalled();
  });

  it("is still writing while the run works", async () => {
    readRun.mockResolvedValue(run("SYNTHESIS"));
    const result = await readReplyDraftAction(RUN);
    expect(result).toEqual({ ok: true, value: { done: false, text: null } });
  });
});
