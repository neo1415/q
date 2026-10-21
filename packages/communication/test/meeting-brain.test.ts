import { describe, expect, it } from "vitest";

import {
  answerFromSnapshot,
  attributeSpeaker,
  audienceOf,
  buildMeetingSnapshot,
  createMeetingMemory,
  renderSnapshot,
  routeMeetingTurn,
  type HostParty,
  type MeetingContextSnapshot,
  type SnapshotSources,
  type SpeakerRef,
} from "../src/index.js";

const ADA: HostParty = {
  userId: "u-ada",
  name: "Adaeze Okafor-Nwosu",
  email: "ada@example.invalid",
  side: "FOUNDER",
  organisation: "Kobo Pay",
};
const KHALID: HostParty = {
  userId: "u-khalid",
  name: "Khalid Al-Thani",
  email: null,
  side: "INVESTOR",
  organisation: "Doha Growth Partners",
};
const parties = [ADA, KHALID];

const ada: SpeakerRef = { name: ADA.name, userId: ADA.userId, side: "FOUNDER" };
const khalid: SpeakerRef = {
  name: KHALID.name,
  userId: KHALID.userId,
  side: "INVESTOR",
};

const SECRET = "Runway is 4 months; we are quietly raising a bridge.";
const INVESTOR_SECRET = "Our internal ceiling for this deal is 2M USD.";

const sources: SnapshotSources = {
  shared: () =>
    Promise.resolve({
      agenda: "Intro and diligence scope for the Kobo Pay seed round.",
      participants: [
        {
          userId: ADA.userId,
          name: ADA.name,
          role: "CEO",
          side: "FOUNDER" as const,
          organisation: ADA.organisation,
        },
        {
          userId: KHALID.userId,
          name: KHALID.name,
          role: "Partner",
          side: "INVESTOR" as const,
          organisation: KHALID.organisation,
        },
      ],
      facts: [
        {
          id: "c1",
          topic: "COMPANY" as const,
          text: "Kobo Pay offers cross-border payments for SMEs in Nigeria",
          source: "company profile",
        },
        {
          id: "m1",
          topic: "MANDATE" as const,
          text: "Fintech and infrastructure in Africa and MENA, cheques of 500k to 2M USD",
          source: "mandate v7",
        },
      ],
    }),
  disclosed: () =>
    Promise.resolve([
      {
        id: "k1",
        topic: "DECK" as const,
        text: "The deck claims 40 percent month on month growth",
        source: "deck:slide 4",
        truth: "USER_CLAIM" as const,
      },
    ]),
  founderPrivate: () =>
    Promise.resolve([
      {
        id: "p1",
        topic: "COMPANY" as const,
        text: SECRET,
        source: "own record",
      },
      { id: "p2", topic: "TERMS" as const, text: SECRET, source: "own record" },
    ]),
  investorPrivate: () =>
    Promise.resolve([
      {
        id: "p1",
        topic: "MANDATE" as const,
        text: INVESTOR_SECRET,
        source: "own record",
      },
    ]),
};

async function snapshot(): Promise<MeetingContextSnapshot> {
  return buildMeetingSnapshot({ meetingId: "m1", sources });
}

describe("snapshot layering and the room as an intersection", () => {
  it("keeps four separate layers and a version", async () => {
    const s = await snapshot();
    expect(s.version).toBe(1);
    expect(s.layers.FOUNDER_PRIVATE.map((f) => f.id)).toEqual(["f:p1", "f:p2"]);
    expect(s.layers.INVESTOR_PRIVATE.map((f) => f.id)).toEqual(["i:p1"]);
    expect(s.layers.SHARED.map((f) => f.id)).toEqual(["s:c1", "s:m1"]);
  });

  it("a two-party room gets neither private layer, in the model context or spoken", async () => {
    const s = await snapshot();
    const room = audienceOf([{ side: "FOUNDER" }, { side: "INVESTOR" }]);
    const rendered = renderSnapshot(s, room);
    expect(rendered).not.toContain("Runway");
    expect(rendered).not.toContain("ceiling");
    expect(rendered).toContain("Kobo Pay offers");
    const memory = createMeetingMemory({ meetingId: "m1" });
    for (const q of [
      "Q, tell me about the company",
      "Q, what are we raising?",
      "Q, what is the mandate?",
      "Q, what is the runway?",
    ]) {
      const route = routeMeetingTurn({
        utterance: q,
        speaker: khalid,
        lineRef: "line:1",
        snapshot: s,
        room: [{ side: "FOUNDER" }, { side: "INVESTOR" }],
        memory,
      });
      const spoken =
        route.kind === "SAY"
          ? route.line
          : route.kind === "MODEL"
            ? route.prepared
            : "";
      expect(spoken).not.toContain("Runway");
      expect(spoken).not.toContain("bridge");
      expect(spoken).not.toContain("ceiling");
    }
  });

  it("the founder alone may hear founder-private facts, never investor-private", async () => {
    const s = await snapshot();
    const alone = audienceOf([{ side: "FOUNDER" }]);
    const rendered = renderSnapshot(s, alone);
    expect(rendered).toContain("Runway");
    expect(rendered).not.toContain("ceiling");
  });

  it("an unidentified person in the room fails closed", async () => {
    const s = await snapshot();
    const room = audienceOf([{ side: "FOUNDER" }, { side: null }]);
    expect(renderSnapshot(s, room)).not.toContain("Runway");
  });

  it("a failing source leaves a named gap, not an invented empty", async () => {
    const s = await buildMeetingSnapshot({
      meetingId: "m1",
      sources: { ...sources, disclosed: () => Promise.reject(new Error("x")) },
    });
    expect(s.gaps).toEqual(["disclosed"]);
    expect(renderSnapshot(s, audienceOf([{ side: "FOUNDER" }]))).toContain(
      "Not available: disclosed",
    );
  });
});

describe("prepared answers read nothing extra", () => {
  it("answers agenda, company, mandate, deck and who is here from the snapshot alone", async () => {
    let reads = 0;
    const count =
      <T>(read: () => Promise<T>) =>
      () => {
        reads += 1;
        return read();
      };
    const s = await buildMeetingSnapshot({
      meetingId: "m1",
      sources: {
        shared: count(sources.shared),
        disclosed: count(sources.disclosed),
        founderPrivate: count(sources.founderPrivate),
        investorPrivate: count(sources.investorPrivate),
      },
    });
    const room = audienceOf([{ side: "FOUNDER" }, { side: "INVESTOR" }]);
    const before = reads;
    expect(before).toBe(4);
    expect(
      answerFromSnapshot(s, room, "what's on the agenda?")?.line,
    ).toContain("diligence scope");
    expect(
      answerFromSnapshot(
        s,
        room,
        "what does the investor invest in, the mandate?",
      )?.line,
    ).toContain("Fintech");
    expect(
      answerFromSnapshot(s, room, "what does the deck say on traction")?.line,
    ).toContain("40 percent");
    expect(answerFromSnapshot(s, room, "who is on the call?")?.line).toContain(
      "Doha Growth Partners",
    );
    expect(
      answerFromSnapshot(s, room, "tell me about the company")?.line,
    ).toContain("cross-border");
    expect(reads).toBe(before);
    expect(answerFromSnapshot(s, room, "will it rain tomorrow")).toBeNull();
    // 2026-10-21 (lane 6, live): a line to Q saying "you" is about Q, never
    // the founder's company.
    expect(answerFromSnapshot(s, room, "Q, what do you do?")).toBeNull();
    expect(
      answerFromSnapshot(s, room, "what does your company do, Q?"),
    ).toBeNull();
    expect(
      answerFromSnapshot(s, room, "what does the company do?")?.line,
    ).toContain("cross-border");
  });
});

describe("calls to Q", () => {
  const room = [{ side: "FOUNDER" as const }, { side: "INVESTOR" as const }];
  async function route(
    utterance: string,
    speaker = ada,
    memory = createMeetingMemory({ meetingId: "m1" }),
  ) {
    return routeMeetingTurn({
      utterance,
      speaker,
      lineRef: "line:9",
      snapshot: await snapshot(),
      room,
      memory,
    });
  }

  it("answers 'Q, can you hear me?' by code", async () => {
    const r = await route("Q, can you hear me?");
    expect(r).toMatchObject({ kind: "SAY", why: "HEARING_CHECK" });
  });

  it("sends 'Q, what do you think?' to the model with the room's context only", async () => {
    const r = await route("Q, what do you think?");
    expect(r.kind).toBe("MODEL");
    if (r.kind === "MODEL") {
      expect(r.opinion).toBe(true);
      expect(r.prepared).not.toContain("Runway");
    }
  });

  it("'hold on, that's not what I meant' is a correction, not a wait", async () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    const [said] = memory.observe({
      speaker: ada,
      text: "I will send the full model by Friday",
      sourceRef: "line:3",
    });
    const r = await route("Q, hold on, that's not what I meant", ada, memory);
    expect(r).toMatchObject({ kind: "SAY", why: "CORRECTION" });
    // The original stays in the record; only the effective view drops it.
    expect(memory.events().some((e) => e.id === said?.id)).toBe(true);
    expect(memory.effective().some((e) => e.id === said?.id)).toBe(false);
  });

  it("'Q, remember that commitment' holds a firm one and says a suggestion is not one", async () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    memory.observe({
      speaker: ada,
      text: "I'll send the data room index by Friday latest",
      sourceRef: "line:1",
    });
    const firm = await route("Q, remember that commitment", ada, memory);
    expect(firm).toMatchObject({ kind: "SAY", why: "REMEMBER" });
    if (firm.kind === "SAY") expect(firm.line).toContain("friday");

    const soft = createMeetingMemory({ meetingId: "m2" });
    soft.observe({
      speaker: khalid,
      text: "Maybe we could do a technical session next week",
      sourceRef: "line:1",
    });
    const r = await route("Q, remember that commitment", khalid, soft);
    if (r.kind === "SAY") expect(r.line).toContain("not an agreement");
  });

  it("stay quiet and resume are read by code", async () => {
    expect((await route("Q, give us a minute")).kind).toBe("QUIET");
    expect((await route("Q, you can come back in now")).kind).toBe("RESUME");
  });

  it("'summarise so far' says what is agreed and what is only suggested", async () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    memory.observe({
      speaker: ada,
      text: "I will share the cap table by Monday",
      sourceRef: "l:1",
    });
    memory.observe({
      speaker: khalid,
      text: "We could look at a bridge structure",
      sourceRef: "l:2",
    });
    const r = await route("Q, summarise where we are", khalid, memory);
    expect(r.kind).toBe("SAY");
    if (r.kind === "SAY") {
      expect(r.line).toContain("Agreed");
      expect(r.line).toContain("Suggested but not agreed");
    }
  });
});

describe("commitment, tentative and suggestion are different things", () => {
  const classify = (text: string, speaker = ada) => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    return memory.observe({ speaker, text, sourceRef: "l:1" });
  };

  it("a firm first-person promise is a commitment with an owner and due", () => {
    const [e] = classify("I will send the deck by Friday");
    expect(e).toMatchObject({
      kind: "COMMITMENT",
      stance: "COMMITMENT",
      ownerName: ADA.name,
      dueText: "friday",
    });
  });

  it("a hedge is tentative and carries no owner or due", () => {
    const [e] = classify("I'll try to send it by Friday, maybe");
    expect(e).toMatchObject({
      stance: "TENTATIVE",
      ownerName: null,
      dueText: null,
    });
  });

  it("a suggestion is not a commitment", () => {
    const [e] = classify("We could meet the CFO next week", khalid);
    expect(e).toMatchObject({
      kind: "PROPOSAL",
      stance: "SUGGESTION",
      ownerName: null,
    });
  });

  it("a request becomes a commitment only when the addressee says yes, never by silence", () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    const [ask] = memory.observe({
      speaker: khalid,
      text: "Can you send the audited accounts by Tuesday?",
      sourceRef: "l:1",
    });
    expect(ask).toMatchObject({
      kind: "ACTION_ITEM",
      stance: "SUGGESTION",
      ownerName: null,
    });
    // Nobody answers: still no commitment.
    memory.observe({
      speaker: khalid,
      text: "Anyway, on the market",
      sourceRef: "l:2",
    });
    expect(memory.events().some((e) => e.kind === "COMMITMENT")).toBe(false);
    const done = memory.observe({
      speaker: ada,
      text: "Yes, will do",
      sourceRef: "l:3",
    });
    expect(done[0]).toMatchObject({
      kind: "COMMITMENT",
      stance: "COMMITMENT",
      ownerName: ADA.name,
      dueText: "tuesday",
    });
  });

  it("the asker's own yes is not the addressee's commitment", () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    memory.observe({
      speaker: khalid,
      text: "Please share the audited accounts",
      sourceRef: "l:1",
    });
    memory.observe({ speaker: khalid, text: "yes sure", sourceRef: "l:2" });
    expect(memory.events().some((e) => e.kind === "COMMITMENT")).toBe(false);
  });

  it("reads Nigerian English and does not take 'well' or 'ill' for a promise", () => {
    expect(classify("I will revert by Friday latest")[0]).toMatchObject({
      stance: "COMMITMENT",
    });
    expect(classify("We shall send the board pack tomorrow")[0]).toMatchObject({
      stance: "COMMITMENT",
    });
    expect(classify("Well, it is a hard market")).toEqual([]);
    // A courtesy phrase does not turn a firm promise into a hedge.
    expect(classify("I will send it tomorrow, inshallah")[0]).toMatchObject({
      stance: "COMMITMENT",
    });
  });
});

describe("a time said in the call is only ever proposed", () => {
  it("founder 'let's do Tuesday 3pm' is PROPOSED + pending; silence never confirms; only the investor's explicit yes resolves it", () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    const made = memory.observe({
      speaker: ada,
      text: "Let's do Tuesday 3pm",
      sourceRef: "l:1",
    });
    expect(made.map((e) => e.kind)).toEqual(["PROPOSAL", "PENDING_APPROVAL"]);
    expect(made[0]?.stance).toBe("SUGGESTION");
    expect(memory.pendingApprovals()).toHaveLength(1);
    // The founder agreeing with her own proposal does not approve it.
    memory.observe({
      speaker: ada,
      text: "That works for me",
      sourceRef: "l:2",
    });
    expect(memory.pendingApprovals()).toHaveLength(1);
    // A bare "okay" or "hmm" is not acceptance.
    memory.observe({ speaker: khalid, text: "Okay, hmm", sourceRef: "l:3" });
    expect(memory.pendingApprovals()).toHaveLength(1);
    memory.observe({
      speaker: khalid,
      text: "Tuesday 3pm works for me, confirmed",
      sourceRef: "l:4",
    });
    expect(memory.pendingApprovals()).toHaveLength(0);
    // And even then, the record has no booking: a follow-up is only proposed.
    expect(memory.closing().followUps.every((f) => f.autoSend === false)).toBe(
      true,
    );
  });

  it("an investor's refusal resolves it as disputed, not confirmed", () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    memory.observe({
      speaker: ada,
      text: "How about Wednesday at 10am?",
      sourceRef: "l:1",
    });
    memory.observe({
      speaker: khalid,
      text: "That doesn't work for me",
      sourceRef: "l:2",
    });
    expect(memory.pendingApprovals()).toHaveLength(0);
    expect(memory.events().some((e) => e.kind === "DISAGREEMENT")).toBe(true);
  });
});

describe("compaction never deletes events", () => {
  it("summarises periodically and keeps every event", () => {
    const seen: string[] = [];
    const memory = createMeetingMemory({
      meetingId: "m1",
      onEvent: (e) => seen.push(e.id),
    });
    for (let i = 0; i < 30; i += 1) {
      memory.observe({
        speaker: khalid,
        text: `What is the position on item ${String(i)}?`,
        sourceRef: `l:${String(i)}`,
      });
    }
    const questions = memory
      .events()
      .filter((e) => e.kind === "QUESTION").length;
    expect(questions).toBe(30);
    expect(memory.events().some((e) => e.kind === "SUMMARY")).toBe(true);
    expect(seen).toHaveLength(memory.events().length);
    memory.compact();
    expect(memory.events().filter((e) => e.kind === "QUESTION")).toHaveLength(
      30,
    );
    expect(memory.contextForModel().length).toBeLessThanOrEqual(2_500);
  });

  it("owner and due exist only on a commitment", () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    memory.observe({
      speaker: ada,
      text: "I'll try to send it by Friday",
      sourceRef: "l:1",
    });
    memory.observe({
      speaker: khalid,
      text: "You could send it by Monday",
      sourceRef: "l:2",
    });
    for (const e of memory.events()) {
      if (e.stance !== "COMMITMENT") {
        expect(e.ownerName).toBeNull();
        expect(e.dueText).toBeNull();
      }
    }
  });

  it("after the call: a summary plus proposed follow-ups, none sent", () => {
    const memory = createMeetingMemory({ meetingId: "m1" });
    memory.observe({
      speaker: ada,
      text: "I will send the cap table by Monday",
      sourceRef: "l:1",
    });
    memory.observe({
      speaker: ada,
      text: "Let's do Tuesday 3pm",
      sourceRef: "l:2",
    });
    const { summary, followUps } = memory.closing();
    expect(summary.commitments[0]).toContain("Monday".toLowerCase());
    expect(followUps.map((f) => f.kind).sort()).toEqual([
      "APPROVAL",
      "COMMITMENT",
    ]);
    expect(followUps.every((f) => f.autoSend === false)).toBe(true);
    expect(memory.events().filter((e) => e.kind === "FOLLOW_UP")).toHaveLength(
      2,
    );
  });
});

describe("attribution by name", () => {
  it("matches a Nigerian hyphenated surname and a Qatari Al- name as the caption shows them", () => {
    expect(attributeSpeaker("Adaeze Okafor Nwosu", parties)).toMatchObject({
      userId: "u-ada",
      side: "FOUNDER",
    });
    expect(attributeSpeaker("Khalid Al Thani (Guest)", parties)).toMatchObject({
      userId: "u-khalid",
      side: "INVESTOR",
    });
    expect(attributeSpeaker("khalid", parties)).toMatchObject({
      side: "INVESTOR",
    });
  });

  it("an unknown caller stays unknown, and so shuts the private layers", () => {
    const who = attributeSpeaker("Galaxy S24", parties);
    expect(who).toEqual({ name: "Galaxy S24", userId: null, side: null });
    expect(
      audienceOf([{ side: "FOUNDER" }, { side: who.side }]).unidentified,
    ).toBe(true);
  });
});
