import { describe, expect, it } from "vitest";

import {
  consequentialLabel,
  documentAskOf,
  instantRequestOf,
} from "../src/instant-request.js";

/**
 * Lane 7 (owner 2026-10-21): what the screen does by itself, read by code
 * with no model. Narrow on purpose: a question is never a command.
 */
describe("instantRequestOf", () => {
  it.each([
    ["close it", { kind: "CLOSE" }],
    ["Close that.", { kind: "CLOSE" }],
    ["Q, close the document please", { kind: "CLOSE" }],
    ["okay, dismiss this", { kind: "CLOSE" }],
    ["can you close the viewer", { kind: "CLOSE" }],
    ["get rid of that", { kind: "CLOSE" }],
    ["I'm done with this", { kind: "CLOSE" }],
    ["go back", { kind: "PAGE_ACT", act: "BACK" }],
    ["take me back", { kind: "PAGE_ACT", act: "BACK" }],
    ["previous page", { kind: "PAGE_ACT", act: "BACK" }],
    ["go forward", { kind: "PAGE_ACT", act: "FORWARD" }],
    ["scroll down", { kind: "PAGE_ACT", act: "SCROLL_DOWN" }],
    ["scroll down a bit", { kind: "PAGE_ACT", act: "SCROLL_DOWN" }],
    ["keep scrolling", { kind: "PAGE_ACT", act: "SCROLL_DOWN" }],
    ["scroll up", { kind: "PAGE_ACT", act: "SCROLL_UP" }],
    ["back to the top", { kind: "PAGE_ACT", act: "SCROLL_TOP" }],
    ["scroll to the bottom", { kind: "PAGE_ACT", act: "SCROLL_BOTTOM" }],
    ["press Book a call", { kind: "PRESS", label: "Book a call", as: "ANY" }],
    [
      "click the filters button",
      { kind: "PRESS", label: "filters", as: "ANY" },
    ],
    ["tap on Readiness", { kind: "PRESS", label: "Readiness", as: "ANY" }],
    [
      "open the Readiness tab",
      { kind: "PRESS", label: "Readiness", as: "TAB" },
    ],
    [
      "switch to the Activity tab",
      { kind: "PRESS", label: "Activity", as: "TAB" },
    ],
  ])("%s", (said, expected) => {
    expect(instantRequestOf(said)).toEqual(expected);
  });

  it.each([
    "close the round",
    "close it... no wait",
    "don't go back",
    "why did the deal close?",
    "what's at the top of my list?",
    "go back to discover",
    "click it",
    "scroll through their financials and tell me what's wrong",
    "close the deal with Nixo",
    "",
  ])("%s is not one", (said) => {
    expect(instantRequestOf(said)).toBeNull();
  });
});

describe("consequentialLabel: what code never presses by itself", () => {
  it.each([
    "Express interest",
    "Send",
    "Approve",
    "Delete document",
    "Pay now",
    "Request access",
    "Book a call",
    "Pass",
    "Save",
    "Sign out",
  ])("%s", (name) => {
    expect(consequentialLabel(name)).toBe(true);
  });
  it.each(["Readiness", "Filters", "Overview", "Next", "Show more"])(
    "%s is safe",
    (name) => {
      expect(consequentialLabel(name)).toBe(false);
    },
  );
});

describe("documentAskOf", () => {
  it.each([
    [
      "open the certificate of incorporation",
      { document: "certificate of incorporation", company: null },
    ],
    [
      "show me Halyard's term sheet",
      { document: "term sheet", company: "Halyard" },
    ],
    [
      "pull up the cap table from Ledgerline",
      { document: "cap table", company: "Ledgerline" },
    ],
    [
      "open the questions for Priya",
      { document: "questions for Priya", company: null },
    ],
    [
      "can you open the shareholders agreement",
      { document: "shareholders agreement", company: null },
    ],
    ["open my investor brief", { document: "investor brief", company: null }],
  ])("%s", (said, expected) => {
    expect(documentAskOf(said)).toEqual(expected);
  });

  it.each([
    "open my documents",
    "open the documents",
    "open Nixo's deck",
    "open the data room",
    "open discover",
    "what does the term sheet say?",
    "open the certificate... no wait",
    "open Halyard",
  ])("%s is not one", (said) => {
    expect(documentAskOf(said)).toBeNull();
  });
});
