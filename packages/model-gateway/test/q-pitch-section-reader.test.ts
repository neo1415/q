import { describe, expect, it } from "vitest";

import type { Logger } from "@capital-q/observability";

import {
  createPitchSectionReader,
  normalisePitchSectionReading,
  pitchTranscriptText,
} from "../src/q/index.js";

/**
 * Lane ov 2026-10-16: Q reads one pitch transcript into the profile's
 * sections. The model is faked: what is checked is what it is sent (that
 * transcript only, moment-marked, fenced as untrusted, CONFIDENTIAL,
 * STRUCTURED_EXTRACTION) and what is kept (known sections only, moments
 * inside the pitch, no figure the founder never said, founder-claim labels
 * set by code).
 */

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as Logger;
const attribution = {
  tenantId: "00000000-0000-4000-8000-0000000000a1",
  correlationId: "cor_x",
};
const SECTIONS = [
  { key: "problem", title: "The Problem" },
  { key: "go_to_market", title: "Go-to-Market Strategy" },
  { key: "ask", title: "Our Ask" },
];
const CUES = [
  { startMs: 2_000, text: "Ports lose a full day per container to paperwork." },
  {
    startMs: 34_000,
    text: "We sell through the freight forwarders, 1,200 containers a month.",
  },
  {
    startMs: 71_000,
    text: "We are raising two million dollars for two new ports.",
  },
];

describe("the transcript as sent", () => {
  it("marks each cue with its moment, in order", () => {
    expect(pitchTranscriptText([...CUES].reverse())).toBe(
      [
        "[0:02] Ports lose a full day per container to paperwork.",
        "[0:34] We sell through the freight forwarders, 1,200 containers a month.",
        "[1:11] We are raising two million dollars for two new ports.",
      ].join("\n"),
    );
  });
});

describe("what is kept", () => {
  it("keeps known sections in the list's order, labelled the founder's claim", () => {
    const reading = normalisePitchSectionReading(
      {
        sections: [
          {
            key: "ask",
            facts: [
              { label: "Raising", value: "two million dollars", atSeconds: 71 },
            ],
          },
          {
            key: "problem",
            facts: [
              {
                label: "Delay",
                value: "a full day per container",
                atSeconds: 2,
              },
            ],
          },
          {
            key: "valuation_secrets",
            facts: [{ label: "x", value: "y", atSeconds: 3 }],
          },
        ],
      },
      SECTIONS,
      CUES,
    );
    expect(reading.map((section) => section.key)).toEqual(["problem", "ask"]);
    expect(reading[0]?.facts[0]).toEqual({
      label: "Delay",
      value: "a full day per container",
      atSeconds: 2,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
    });
  });

  it("drops a figure the founder never said and a moment past the pitch's end", () => {
    const reading = normalisePitchSectionReading(
      {
        sections: [
          {
            key: "go_to_market",
            facts: [
              { label: "Containers a month", value: "1200", atSeconds: 34 },
              { label: "Containers a month", value: "5,000", atSeconds: 34 },
              { label: "Channel", value: "freight forwarders", atSeconds: 900 },
            ],
          },
        ],
      },
      SECTIONS,
      CUES,
    );
    expect(reading).toEqual([
      {
        key: "go_to_market",
        facts: [expect.objectContaining({ value: "1200", atSeconds: 34 })],
      },
    ]);
  });

  it("leaves out a section with nothing true left: unknown stays unknown", () => {
    expect(
      normalisePitchSectionReading(
        {
          sections: [
            {
              key: "problem",
              facts: [{ label: "Loss", value: "40%", atSeconds: 2 }],
            },
          ],
        },
        SECTIONS,
        CUES,
      ),
    ).toEqual([]);
  });
});

describe("the reader", () => {
  it("sends only that transcript, fenced and CONFIDENTIAL, through STRUCTURED_EXTRACTION", async () => {
    const sent: { taskClass: string; sensitivity: string; text: string }[] = [];
    const reader = createPitchSectionReader({
      logger,
      gateway: {
        execute: (request) => {
          sent.push({
            taskClass: request.taskClass,
            sensitivity: request.sensitivity,
            text: JSON.stringify(request.messages),
          });
          return Promise.resolve({
            output: {
              kind: "STRUCTURED",
              value: {
                sections: [
                  {
                    key: "problem",
                    facts: [
                      {
                        label: "Delay",
                        value: "a full day per container",
                        atSeconds: 2,
                      },
                    ],
                  },
                ],
              },
            },
          } as never);
        },
      },
    });
    const reading = await reader.read({
      sections: SECTIONS,
      durationSeconds: 90,
      cues: CUES,
      attribution,
    });
    expect(reading).toEqual([expect.objectContaining({ key: "problem" })]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.taskClass).toBe("STRUCTURED_EXTRACTION");
    expect(sent[0]?.sensitivity).toBe("CONFIDENTIAL");
    expect(sent[0]?.text).toContain(
      "[0:34] We sell through the freight forwarders",
    );
    expect(sent[0]?.text).toContain("go_to_market: Go-to-Market Strategy");
    expect(sent[0]?.text).toMatch(/UNTRUSTED_CONTENT/u);
  });

  it("is null when the model fails, and never calls it without a transcript", async () => {
    let calls = 0;
    const reader = createPitchSectionReader({
      logger,
      gateway: {
        execute: () => {
          calls += 1;
          return Promise.reject(new Error("provider down"));
        },
      },
    });
    expect(
      await reader.read({
        sections: SECTIONS,
        durationSeconds: null,
        cues: CUES,
        attribution,
      }),
    ).toBeNull();
    expect(
      await reader.read({
        sections: SECTIONS,
        durationSeconds: null,
        cues: [],
        attribution,
      }),
    ).toBeNull();
    expect(calls).toBe(1);
  });
});
