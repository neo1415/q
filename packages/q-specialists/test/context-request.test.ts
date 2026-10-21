import { describe, expect, it } from "vitest";

import { contextAskOf } from "../src/context-request.js";

/**
 * Lane 7 (owner 2026-10-21: "names must NOT be required"): requests that
 * point instead of naming, read by code.
 */
describe("contextAskOf", () => {
  it.each([
    ["open their deck", { pointer: null, owned: true, part: "DECK" }],
    ["show me their pitch deck", { pointer: null, owned: true, part: "DECK" }],
    ["open this one", { pointer: { kind: "THIS" }, owned: false, part: null }],
    ["open it", { pointer: { kind: "THIS" }, owned: false, part: null }],
    ["show me that", { pointer: { kind: "THAT" }, owned: false, part: null }],
    [
      "okay, open that one please",
      { pointer: { kind: "THAT" }, owned: false, part: null },
    ],
    ["open their stuff", { pointer: null, owned: true, part: "STUFF" }],
    [
      "go back to the other one",
      { pointer: { kind: "OTHER" }, owned: false, part: null },
    ],
    [
      "take me to the other one's deck",
      { pointer: { kind: "OTHER" }, owned: true, part: "DECK" },
    ],
    [
      "open the second one",
      { pointer: { kind: "ORDINAL", position: 2 }, owned: false, part: null },
    ],
    [
      "show me the last one",
      { pointer: { kind: "ORDINAL", position: -1 }, owned: false, part: null },
    ],
    [
      "open the first one's data room",
      {
        pointer: { kind: "ORDINAL", position: 1 },
        owned: true,
        part: "DATA_ROOM",
      },
    ],
    ["open the memo", { pointer: null, owned: false, part: "MEMO" }],
    [
      "show me the financials",
      { pointer: null, owned: false, part: "FINANCIALS" },
    ],
    [
      "pull up that deck",
      { pointer: { kind: "THAT" }, owned: false, part: "DECK" },
    ],
    ["open its data room", { pointer: null, owned: true, part: "DATA_ROOM" }],
    ["open this company's team", { pointer: null, owned: true, part: "TEAM" }],
    ["open their chat", { pointer: null, owned: true, part: "CHAT" }],
    ["show me the doc", { pointer: null, owned: false, part: "DOCUMENT" }],
  ])("%s", (said, expected) => {
    expect(contextAskOf(said)).toEqual(expected);
  });

  it.each([
    "open discover",
    "open Nixo's deck",
    "open their deck... no wait",
    "what's in their deck?",
    "open the certificate of incorporation",
    "close it",
    "open their",
    "",
  ])("%s is not one", (said) => {
    expect(contextAskOf(said)).toBeNull();
  });
});
