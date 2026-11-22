import { describe, expect, it } from "vitest";

import { QToolNameSchema, type QResultBlock } from "@capital-q/contracts";
import type { PublicSourceLike } from "@capital-q/q-core";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  collectClientActionBlock,
  collectDocumentBlock,
  collectPublicSources,
  collectScheduleBlock,
} from "../src/q/answer-tool-results.js";
import type { SearchEvidence } from "../src/q/picture-corroboration.js";

/**
 * W5-A: characterisation of the two answer phases moved out of
 * createModelGatewayQAnswer (tool outcomes into the answer's blocks; the
 * public sources a web read cited). Written against the code as it stood,
 * and kept: the move changes nothing these pin.
 */

const outcome = (
  toolName: string | null,
  data: unknown,
  ok = true,
): QToolCallOutcome => ({
  callId: "c1",
  toolName: toolName === null ? null : QToolNameSchema.parse(toolName),
  toolVersion: 1,
  classification: null,
  status: ok ? "SUCCEEDED" : "FAILED",
  failureCode: ok ? null : "FAILED",
  sensitivity: null,
  result: ok
    ? { ok: true, data }
    : { ok: false, error: { code: "FAILED", safeMessage: "It failed." } },
  latencyMs: 1,
});

const ARTIFACT = "a1000000-0000-4000-8000-000000000001";
const document = (version: number, slide?: number) => ({
  status: "DOCUMENT_UPDATED",
  document: {
    artifactId: ARTIFACT,
    type: "PITCH_DECK",
    status: "READY",
    title: `Seed deck v${String(version)}`,
    currentVersion: version,
  },
  ...(slide === undefined ? {} : { slide }),
});

describe("phase 1: a tool outcome into the answer's blocks", () => {
  it("a client action is added once, in order; a failed or unrelated result adds nothing", () => {
    const blocks: QResultBlock[] = [
      { kind: "UI_INTENT", intent: { kind: "NAVIGATE", destination: "WORK" } },
    ];
    const theme = {
      status: "SCREEN_WILL_DO_IT",
      clientAction: { kind: "SET_THEME", theme: "dark" },
    };
    collectClientActionBlock({
      blocks,
      outcome: outcome("q.set_theme", theme),
    });
    collectClientActionBlock({
      blocks,
      outcome: outcome("q.set_theme", theme),
    });
    collectClientActionBlock({
      blocks,
      outcome: outcome("q.set_theme", theme, false),
    });
    collectClientActionBlock({
      blocks,
      outcome: outcome("q.anything", { rows: [] }),
    });
    expect(blocks).toEqual([
      { kind: "UI_INTENT", intent: { kind: "NAVIGATE", destination: "WORK" } },
      { kind: "UI_INTENT", intent: { kind: "SET_THEME", theme: "dark" } },
    ]);
  });

  it("reads a calendar connect card, a language switch and a room card from their carriers", () => {
    const blocks: QResultBlock[] = [];
    collectClientActionBlock({
      blocks,
      outcome: outcome("q.list_schedule", {
        other: 1,
        clientAction: {
          kind: "SHOW_CALENDAR_CONNECT",
          reason: "NOT_CONNECTED",
          timeZone: null,
          suggested: [],
        },
      }),
    });
    collectClientActionBlock({
      blocks,
      outcome: outcome("q.set_q_language", {
        saved: true,
        clientAction: { kind: "SET_LANGUAGE", language: "ar" },
      }),
    });
    expect(
      blocks.map((b) => (b.kind === "UI_INTENT" ? b.intent.kind : b.kind)),
    ).toEqual(["SHOW_CALENDAR_CONNECT", "SET_LANGUAGE"]);
  });

  it("a revised document's card replaces the earlier one, and its slide moves the viewer once", () => {
    const blocks: QResultBlock[] = [];
    collectDocumentBlock({
      blocks,
      outcome: outcome("q.edit_my_document", document(2, 3)),
    });
    collectDocumentBlock({
      blocks,
      outcome: outcome("q.edit_my_document", document(3, 5)),
    });
    collectDocumentBlock({
      blocks,
      outcome: outcome("q.edit_my_document", { status: "x" }),
    });
    expect(blocks).toEqual([
      {
        kind: "ARTIFACT_REFERENCE",
        artifactId: ARTIFACT,
        type: "PITCH_DECK",
        status: "READY",
        title: "Seed deck v3",
      },
      {
        kind: "UI_INTENT",
        intent: { kind: "DOCUMENT_ACT", act: "GO_TO_PAGE", page: 5 },
      },
    ]);
  });

  it("the schedule card comes only from list_schedule, and the latest replaces the earlier", () => {
    const blocks: QResultBlock[] = [];
    const schedule = {
      meetings: [],
      reminders: [],
    };
    collectScheduleBlock({
      blocks,
      name: "list_messages",
      outcome: outcome("q.list_messages", schedule),
      ownDayReads: null,
    });
    expect(blocks).toEqual([]);
    collectScheduleBlock({
      blocks,
      name: "list_schedule",
      outcome: outcome("q.list_schedule", "not a read"),
      ownDayReads: null,
    });
    expect(blocks).toEqual([]);
    collectScheduleBlock({
      blocks,
      name: "list_schedule",
      outcome: outcome("q.list_schedule", schedule),
      ownDayReads: { approvals: undefined, timeZone: "Africa/Lagos" },
    });
    collectScheduleBlock({
      blocks,
      name: "list_schedule",
      outcome: outcome("q.list_schedule", schedule),
      ownDayReads: { approvals: undefined, timeZone: "Africa/Lagos" },
    });
    expect(blocks.map((b) => b.kind)).toEqual(["SCHEDULE"]);
    const [card] = blocks;
    expect(card?.kind === "SCHEDULE" ? card.timeZone : null).toBe(
      "Africa/Lagos",
    );
  });
});

describe("phase 2: the public sources a web read cited", () => {
  const source = (url: string, extra: Record<string, unknown> = {}) => ({
    index: 1,
    url,
    domain: "techcabal.com",
    title: "Ajopot raises",
    publishedAt: "2026-10-01",
    retrievedAt: "2026-11-01T00:00:00.000Z",
    subjectMatch: "EXACT",
    mentionedCountries: ["Nigeria", 3],
    excerpt: "Ajopot raised a seed round.",
    ...extra,
  });

  it("keeps the evidence of every source and presents each well-formed one once", () => {
    const webEvidence: SearchEvidence[] = [];
    const pageSubjectMatch = new Map<string, string>();
    const publicSources: PublicSourceLike[] = [];
    const sinks = { webEvidence, pageSubjectMatch, publicSources };
    collectPublicSources({
      ...sinks,
      outcome: outcome("public_web.search", {
        sources: [
          source("https://techcabal.com/a"),
          source("https://techcabal.com/a"),
          source("https://techcabal.com/b", { retrievedAt: 7 }),
        ],
      }),
    });
    expect(webEvidence).toHaveLength(3);
    expect(webEvidence[0]).toEqual({
      domain: "techcabal.com",
      subjectMatch: "EXACT",
      countries: ["Nigeria"],
      text: "Ajopot raised a seed round.",
      title: "Ajopot raises",
    });
    expect([...pageSubjectMatch]).toEqual([
      ["https://techcabal.com/a", "EXACT"],
    ]);
    expect(publicSources).toEqual([
      {
        index: 1,
        url: "https://techcabal.com/a",
        domain: "techcabal.com",
        title: "Ajopot raises",
        publishedAt: "2026-10-01",
        retrievedAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
  });

  it("reads only the web search and the profile gap fill, and only when they succeeded", () => {
    const sinks = {
      webEvidence: [] as SearchEvidence[],
      pageSubjectMatch: new Map<string, string>(),
      publicSources: [] as PublicSourceLike[],
    };
    const data = { sources: [source("https://techcabal.com/a")] };
    collectPublicSources({
      ...sinks,
      outcome: outcome("q.list_messages", data),
    });
    collectPublicSources({
      ...sinks,
      outcome: outcome("public_web.search", data, false),
    });
    expect(sinks.publicSources).toEqual([]);
    collectPublicSources({
      ...sinks,
      outcome: outcome("profile.gaps.fill", data),
    });
    expect(sinks.publicSources).toHaveLength(1);
  });
});
