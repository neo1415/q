import { describe, expect, it } from "vitest";

import {
  explicitlyApproves,
  mayStandAsApproval,
  readApprovalWords,
  readEditRequest,
} from "../src/approval-words.js";

/**
 * The deterministic floor under approval by conversation (owner
 * 2026-10-16): plain decision words are read by code; anything else is
 * left to the readings of meaning, and a change asked for never approves.
 */

const CARD = "Send the follow-up to Harbourline";

describe("readApprovalWords", () => {
  it.each([
    "I approve",
    "I approve.",
    "yes, send it",
    "Go ahead",
    "go ahead please",
    "Confirmed",
    "I confirm it",
    "approve it",
    "I have given my approval",
    "I've given you my approval already",
    "Okay. I give the approval. Go ahead.",
    "you have my approval",
    "No problem, go ahead.",
    "Q, send the follow-up to Harbourline",
    "approve the Harbourline one",
    "موافق",
    "نعم، أرسلها",
    "تمام، وأرسلها من فضلك",
    "توكل على الله",
  ])("%s: an explicit approval of one card", (said) => {
    const words = readApprovalWords(said, { summaries: [CARD] });
    expect(words).toMatchObject({
      kind: "APPROVE",
      scope: "ONE",
      strength: "EXPLICIT",
    });
    expect(explicitlyApproves(words)).toBe(true);
  });

  it.each([
    ["approve both", "BOTH"],
    ["yes, send both of them", "BOTH"],
    ["approve all of them", "ALL"],
    ["موافق على الاثنين", "BOTH"],
    ["اعتمد الكل", "ALL"],
  ])("%s: approves %s", (said, scope) => {
    expect(readApprovalWords(said)).toMatchObject({
      kind: "APPROVE",
      scope,
      strength: "EXPLICIT",
    });
  });

  it.each(["yes", "ok", "sure", "sounds good", "نعم", "تمام"])(
    "%s: a plain yes, left to the readings of meaning",
    (said) => {
      const words = readApprovalWords(said);
      expect(words).toMatchObject({ kind: "APPROVE", strength: "PLAIN" });
      expect(explicitlyApproves(words)).toBe(false);
    },
  );

  it.each([
    "no, don't send it",
    "cancel that",
    "don't do it",
    "decline",
    "never mind",
    "لا ترسلها",
    "ألغها",
    "ارفض",
  ])("%s: an explicit refusal", (said) => {
    expect(readApprovalWords(said, { summaries: [CARD] })).toMatchObject({
      kind: "DECLINE",
      strength: "EXPLICIT",
    });
  });

  it.each([
    "sounds good, but change the date",
    "yes but make it Friday instead",
    "approve it, but add Tom",
    "go ahead after lunch",
    "wait",
    "not yet",
    "hold on",
    "تمام لكن غير التاريخ",
    "موافق بس بعدين",
  ])("%s: a change asked for, never an approval", (said) => {
    expect(readApprovalWords(said, { summaries: [CARD] })).toEqual({
      kind: "EDIT",
    });
    expect(mayStandAsApproval(said, [CARD])).toBe(false);
  });

  it.each([
    "send it on Friday",
    "should I approve it?",
    "approve?",
    "what is Harbourline raising",
    "no, go ahead",
    "I'm not sure",
    "",
  ])("%s: not read here", (said) => {
    expect(readApprovalWords(said, { summaries: [CARD] })).toEqual({
      kind: "NONE",
    });
  });

  it("a refusal word that is the card's own verb is not read ('cancel it' to a cancel card)", () => {
    expect(
      readApprovalWords("cancel it", {
        summaries: ["Cancel the call with Nixo"],
      }),
    ).toEqual({ kind: "NONE" });
  });

  it("names, positions and 'both' alone point at a card without deciding", () => {
    expect(
      readApprovalWords("the Harbourline one", { summaries: [CARD] }),
    ).toEqual({ kind: "REFER", scope: "ONE", ordinal: null });
    expect(readApprovalWords("the second one")).toEqual({
      kind: "REFER",
      scope: "ONE",
      ordinal: 2,
    });
    expect(readApprovalWords("both")).toEqual({
      kind: "REFER",
      scope: "BOTH",
      ordinal: null,
    });
    expect(readApprovalWords("approve the first one")).toMatchObject({
      kind: "APPROVE",
      ordinal: 1,
    });
  });
});

describe("readEditRequest (live 2026-10-16)", () => {
  it.each([
    ["Sounds good but change the date", "date", false],
    ["yes but change the time", "time", false],
    ["change it", null, false],
    ["change the date to Friday", "date", true],
    ["move it to 3pm", null, true],
    ["make it 30 minutes instead", null, true],
    ["تمام لكن غير التاريخ", "التاريخ", false],
  ] as const)("%s: field %s, value given %s", (said, field, valueGiven) => {
    expect(readEditRequest(said, { summaries: [CARD] })).toEqual({
      field,
      valueGiven,
    });
  });

  it("is null for anything that is not an edit", () => {
    expect(readEditRequest("I approve")).toBeNull();
    expect(readEditRequest("what is Harbourline raising")).toBeNull();
  });
});
