import { describe, expect, it } from "vitest";

import { QMessageSchema, type QMessage } from "@capital-q/contracts";
import type { SceneLine } from "@capital-q/q-pitch";

import { demoTop } from "@/features/q/answer-canvas-fixtures";
import {
  fixtureKeysOf,
  receiptCompanies,
  resolveCompanyFixture,
} from "@/features/q-pitch/fixtures";
import {
  captionSpeak,
  createNarrator,
  LIVE_LATE_START_MS,
  readingMs,
  type LiveNarration,
} from "@/features/q-pitch/narrator";

const LEDGERFOLD = "0b9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f00";
const F2 = "1c9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f01";
const RUN = "2c9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f02";

let messageSeq = 0;
function messageId(): string {
  messageSeq += 1;
  return `3c9a8c3e-4f61-4d2a-9c1e-${String(messageSeq).padStart(12, "0")}`;
}

/** A real, schema-valid Q message with answer cards (demo card shape). */
function cardsMessage(
  cards: { name: string; companyId: string | null }[],
): QMessage {
  const block = demoTop(cards.length);
  return QMessageSchema.parse({
    messageId: messageId(),
    runId: RUN,
    role: "Q",
    createdAt: "2026-10-15T00:00:00.000Z",
    blocks: [
      {
        ...block,
        cards: block.cards.map((card, i) => ({
          ...card,
          name: cards[i]?.name ?? card.name,
          subject:
            cards[i]?.companyId == null
              ? null
              : { kind: "COMPANY", companyId: cards[i]?.companyId },
        })),
      },
    ],
  });
}

const OTHER_RUN = "4c9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f04";

describe("Q Pitch companies come only from the acknowledged receipt", () => {
  it("card-N is the Nth company card of the acknowledged run, in order", () => {
    const receipt = receiptCompanies(
      [
        cardsMessage([
          { name: "Duplo", companyId: LEDGERFOLD },
          { name: "Bumpa", companyId: F2 },
        ]),
      ],
      RUN,
    );
    expect(resolveCompanyFixture("card-1", receipt)).toEqual({
      companyId: LEDGERFOLD,
      name: "Duplo",
    });
    expect(resolveCompanyFixture("card-2", receipt)?.name).toBe("Bumpa");
    expect(resolveCompanyFixture("card-3", receipt)).toBeNull();
  });

  it("never resolves a hard-coded name, or cards from another run", () => {
    const messages = [
      cardsMessage([{ name: "Ledgerfold", companyId: LEDGERFOLD }]),
    ];
    expect(
      resolveCompanyFixture("ledgerfold", receiptCompanies(messages, RUN)),
    ).toBeNull();
    expect(receiptCompanies(messages, OTHER_RUN)).toEqual([]);
    expect(resolveCompanyFixture("card-1", [])).toBeNull();
  });

  it("skips cards without a resolved company record", () => {
    const receipt = receiptCompanies(
      [
        cardsMessage([
          { name: "Unresolved", companyId: null },
          { name: "Bumpa", companyId: F2 },
        ]),
      ],
      RUN,
    );
    expect(resolveCompanyFixture("card-1", receipt)?.name).toBe("Bumpa");
  });

  it("does not let a person's own typed text name a record", () => {
    const typed = QMessageSchema.parse({
      messageId: messageId(),
      runId: RUN,
      role: "USER",
      text: "Open Ledgerfold",
      createdAt: "2026-10-15T00:00:00.000Z",
    });
    expect(receiptCompanies([typed], RUN)).toEqual([]);
  });

  it("lists every fixture a scene's actions name", () => {
    expect(
      fixtureKeysOf([
        { actionId: "ta_open", kind: "openCompany", company: "card-1" },
        {
          actionId: "ta_cmp",
          kind: "buildComparison",
          question: "q.compare-two",
          companies: ["card-1", "card-2"],
        },
      ]),
    ).toEqual(["card-1", "card-2"]);
  });
});

describe("caption narrator", () => {
  it("gives each line a bounded reading time", () => {
    expect(readingMs("Hello.")).toBe(1_500);
    expect(readingMs(Array.from({ length: 25 }, () => "word").join(" "))).toBe(
      10_000,
    );
    expect(readingMs(Array.from({ length: 200 }, () => "w").join(" "))).toBe(
      14_000,
    );
  });

  it("stops at once when interrupted", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const speaking = captionSpeak(
      [
        {
          lineId: "l.test",
          kind: "CONNECTIVE",
          text: "A long line that would take a while to read on screen.",
          claimIds: [],
          timing: "BEFORE_ACK",
          source: "test",
        },
      ],
      controller.signal,
    );
    controller.abort();
    await speaking;
    expect(Date.now() - started).toBeLessThan(500);
  });
});

const LINE = (text: string): SceneLine => ({
  lineId: "l.test",
  kind: "CONNECTIVE",
  text,
  claimIds: [],
  timing: "AFTER_ACK",
  source: "test",
});

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 10_000 && !done(); i++) await Promise.resolve();
  expect(done()).toBe(true);
}

/** A narrator on a virtual clock; `speakingAt` scripts the live voice. */
function voiced(options: {
  live: boolean;
  speakingAt?: (ms: number) => boolean;
  tts?: boolean;
}) {
  let clock = 0;
  const said: string[] = [];
  const hush: boolean[] = [];
  const tts: string[] = [];
  const live: LiveNarration = {
    say: (text) => {
      said.push(text);
      return true;
    },
    speaking: () => options.speakingAt?.(clock) ?? false,
    hush: (on) => hush.push(on),
  };
  const narrator = createNarrator({
    live: () => (options.live ? live : null),
    tts: (text) => {
      tts.push(text);
      return Promise.resolve(options.tts ?? true);
    },
    now: () => clock,
    wait: (ms, signal) => {
      if (!signal.aborted) clock += Math.max(0, ms);
      return Promise.resolve();
    },
  });
  return { narrator, said, hush, tts, at: () => clock };
}

describe("the voiced narrator (Q's own voice; captions stay)", () => {
  it("says the line on the open live line and waits until it has been heard", async () => {
    const h = voiced({ live: true, speakingAt: (t) => t >= 400 && t < 3_000 });
    await h.narrator.speak(
      [LINE("One place for everything.")],
      new AbortController().signal,
    );
    expect(h.said).toEqual(["One place for everything."]);
    expect(h.tts).toEqual([]);
    expect(h.narrator.lastChannel()).toBe("LIVE");
    // Not before the voice finished (plus the quiet window).
    expect(h.at()).toBeGreaterThanOrEqual(3_000);
    expect(h.hush).toEqual([]);
  });

  it("falls back to Q's standard TTS voice when no live line is open", async () => {
    const h = voiced({ live: false });
    await h.narrator.speak([LINE("Hello.")], new AbortController().signal);
    expect(h.said).toEqual([]);
    expect(h.tts).toEqual(["Hello."]);
    expect(h.narrator.lastChannel()).toBe("TTS");
  });

  it("keeps the caption's reading time when no audio can play", async () => {
    const h = voiced({ live: false, tts: false });
    const text = Array.from({ length: 25 }, () => "word").join(" ");
    await h.narrator.speak([LINE(text)], new AbortController().signal);
    expect(h.narrator.lastChannel()).toBe("CAPTION");
    expect(h.at()).toBeGreaterThanOrEqual(readingMs(text));
  });

  it("Pause/Skip/Back: silences the live line at once, then restores it", async () => {
    const controller = new AbortController();
    const h = voiced({ live: true, speakingAt: (t) => t >= 200 && t < 6_000 });
    const speaking = h.narrator.speak(
      [LINE("A long line.")],
      controller.signal,
    );
    await Promise.resolve();
    // Cancel while Q is audible.
    await until(() => h.at() >= 1_000);
    controller.abort();
    await speaking;
    await new Promise((r) => setTimeout(r, 0));
    expect(h.hush[0]).toBe(true);
    expect(h.hush.at(-1)).toBe(false);
  });

  it("an audience barge-in (provider already cut Q off) hushes nothing", async () => {
    const controller = new AbortController();
    // Q spoke, the provider cut it off when the person started talking,
    // and their words arrive (the tour pauses) a moment later.
    const stopped = LIVE_LATE_START_MS + 500;
    const h = voiced({
      live: true,
      speakingAt: (t) => t >= 200 && t < stopped,
    });
    const speaking = h.narrator.speak(
      [LINE("A long line.")],
      controller.signal,
    );
    await until(() => h.at() >= stopped + 200);
    controller.abort();
    await speaking;
    expect(h.hush).toEqual([]);
  });

  it("speaks nothing once aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = voiced({ live: true });
    await h.narrator.speak([LINE("Hello.")], controller.signal);
    expect(h.said).toEqual([]);
    expect(h.tts).toEqual([]);
  });
});

describe("the tour's subject company (server setting, viewer-checked)", () => {
  const SUBJECT = { companyId: LEDGERFOLD, name: "Capital Q" };

  it("resolves only the `subject` key, and only when the server gave one", () => {
    expect(resolveCompanyFixture("subject", [], SUBJECT)).toEqual(SUBJECT);
    expect(resolveCompanyFixture("subject", [], null)).toBeNull();
    expect(resolveCompanyFixture("card-1", [], SUBJECT)).toBeNull();
  });

  it("needs a well-formed configured id and a read that succeeds as the viewer", async () => {
    const { resolveTourSubjectWith } =
      await import("@/features/q-pitch/subject-model");
    const read = (id: string) =>
      Promise.resolve(id === LEDGERFOLD ? SUBJECT : null);
    expect(await resolveTourSubjectWith(undefined, read)).toBeNull();
    expect(await resolveTourSubjectWith("not-a-uuid", read)).toBeNull();
    expect(await resolveTourSubjectWith(F2, read)).toBeNull();
    expect(
      await resolveTourSubjectWith(LEDGERFOLD.toUpperCase(), read),
    ).toEqual(SUBJECT);
    // A read that answers for another company is not this subject.
    expect(
      await resolveTourSubjectWith(LEDGERFOLD, () =>
        Promise.resolve({ companyId: F2, name: "Elsewhere" }),
      ),
    ).toBeNull();
    // A refused read is no subject, never an error.
    expect(
      await resolveTourSubjectWith(LEDGERFOLD, () =>
        Promise.reject(new Error("403")),
      ),
    ).toBeNull();
  });
});
