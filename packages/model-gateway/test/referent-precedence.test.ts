import { describe, expect, it } from "vitest";

import { onScreenCompanyFact } from "../src/q/company-fact.js";
import { POINTING_LINE, screenSubjectNote } from "../src/q/index.js";

/**
 * Owner live test, 7 Nov 2026 (R2): "i meant me, what can you find about me
 * online" was answered "You mean Clearwater Assurance" (the company on the
 * screen), and pointing words were bound to the screen even when the
 * conversation was about another company. Every rule the answer is given
 * about pointing now says the same precedence as the situation: first
 * person is always the person; a pointing word follows the conversation,
 * then the screen.
 */
describe("the answer's pointing rules (R2)", () => {
  it("POINTING_LINE: the conversation first, then the screen; first person is never the screen", () => {
    expect(POINTING_LINE).toMatch(
      /they mean what the conversation is about, and when it names nothing, what their screen shows/u,
    );
    expect(POINTING_LINE).toMatch(
      /Me, my, I and myself always mean themselves, never what is on their screen/u,
    );
  });

  it("the on-screen company fact is 'this company' only when the conversation names no other, never 'me'", () => {
    const fact = onScreenCompanyFact({ canonicalName: "Clearwater Assurance" });
    expect(fact?.statement).toMatch(/when the conversation names no other/u);
    expect(fact?.statement).toMatch(/never what they mean by me or my/u);
  });

  it("asked who they mean, the screen answers pointing words, never first person", () => {
    const note = screenSubjectNote({
      route: "COMPANY",
      companyId: "3f1d2c4b-5a6e-4f70-8a91-0b2c3d4e5f61",
    });
    expect(note?.content).toMatch(
      /unless the conversation names another; me, my, I and myself are always themselves/u,
    );
  });
});

/**
 * Owner live test, 7 Nov 2026 (R6): replies said "The previous screen
 * action opened …", "… was opened on screen". The receipts the answer is
 * given are records about the person's screen; the note that carries them
 * now says they are never words to repeat, and how to say them.
 */
describe("the screen receipts note (R6)", () => {
  it("records, not words: speak to them as you, never narrate the receipt", async () => {
    const { screenActsNote } = await import("../src/q/index.js");
    const note = screenActsNote(["Opened /company/x on their screen (DONE)."]);
    expect(note?.content).toMatch(
      /records for you, never words to repeat: say it to them as you \(I opened it for you\)/u,
    );
    expect(note?.content).toMatch(
      /never the user, the person, on screen or the previous screen action/u,
    );
  });
});

/**
 * Owner replay batch 7 (#9): a page action prepared for their approval was
 * read as a miss, and the next turn opened "My last step on your screen
 * didn't go through". A prepared act is not a miss.
 */
describe("a prepared act is never a miss (#9)", () => {
  it("screenActMissLine passes over an act waiting for their approval", async () => {
    const { screenActMissLine } = await import("../src/q/index.js");
    expect(
      screenActMissLine(
        [
          "ACTIVATE button.send-questions: prepared, NOT done: it waits for their approval of exactly this (AWAITING_APPROVAL).",
        ],
        null,
      ),
    ).toBeNull();
    expect(
      screenActMissLine(
        [
          "ACTIVATE button.x: NOT done: that control cannot do that (NOT_APPLICABLE).",
        ],
        null,
      ),
    ).toMatch(/didn't go through/u);
  });
});

/**
 * Owner replay batch 7 (#9): "who has viewed my profile?" was answered
 * "Capital Q doesn't show profile viewers by design": an always-on note
 * written before Analytics said founders never see who viewed. Who viewed
 * them is read now (read_my engagement), at the level each viewer chose;
 * viewing is still not interest and never a reason to contact.
 */
describe("the viewing note (#9)", () => {
  it("reads who viewed them, and keeps viewing apart from interest", async () => {
    const { VIEWING_NOT_DISCLOSED_NOTE } = await import("../src/q/index.js");
    expect(VIEWING_NOT_DISCLOSED_NOTE).not.toMatch(/never see who viewed/u);
    expect(VIEWING_NOT_DISCLOSED_NOTE).not.toMatch(/by design/u);
    expect(VIEWING_NOT_DISCLOSED_NOTE).toMatch(/read_my with kind engagement/u);
    expect(VIEWING_NOT_DISCLOSED_NOTE).toMatch(
      /at the level each viewer chose/u,
    );
    expect(VIEWING_NOT_DISCLOSED_NOTE).toMatch(/never a reason to contact/u);
  });
});

/**
 * Owner replay batch 7 (#8): after operate_screen prepared the page's own
 * three questions, Q said "The page action was activated to prepare the
 * three questions for Babatunde Oyelaran's approval." The result Q reads
 * when a screen act is under way now says how to tell them.
 */
describe("a screen act's result says how to tell them (#8)", () => {
  it("SCREEN_WILL_DO_IT carries tellThem; other results are unchanged", async () => {
    const { toolResultMessage } = await import("../src/q/index.js");
    const call = { callId: "c1", name: "operate_screen", arguments: {} };
    const acted = toolResultMessage(call, {
      result: {
        ok: true,
        data: {
          status: "SCREEN_WILL_DO_IT",
          clientAction: {
            kind: "UI_ACT",
            actId: "uia_send000001",
            act: "ACTIVATE",
            target: "button.send-questions",
          },
        },
      },
    } as never);
    const body = JSON.parse(acted.content) as { tellThem?: string };
    expect(body.tellThem).toMatch(
      /Tell them in the first person, to them, what you did: I've prepared it for your approval/u,
    );
    expect(body.tellThem).toMatch(
      /never describe the step \(activated, the page action, on screen\)/u,
    );
    const read = toolResultMessage(
      { callId: "c2", name: "read_my", arguments: {} },
      { result: { ok: true, data: { kind: "media", items: [] } } } as never,
    );
    expect(JSON.parse(read.content)).toEqual({
      ok: true,
      data: { kind: "media", items: [] },
    });
  });
});
