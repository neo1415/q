import { describe, expect, it } from "vitest";

import type {
  QConversationFetch,
  QConversationMessage,
} from "@capital-q/q-runtime";

import {
  earlierResearchNote,
  earlierResearchPages,
  earlierResearchSubjects,
} from "../src/q/earlier-research.js";
import { followsUpPublicSources } from "../src/q/research-follow-up.js";
import {
  analystResultBlocks,
  publicStandingsOf,
} from "../src/q/result-blocks.js";

/**
 * Investigation milestone (12 Nov 2026): a follow-up to a public-web
 * research turn keeps the pages it read -- to answer from, to cite, and so
 * that the web is not searched again for what was just found. Live
 * (Paystack, 12 Nov): the follow-up's record of that research was 240
 * characters of escaped JSON, and only a pronoun question skipped the
 * fresh search.
 */
const message = (
  id: string,
  runId: string,
  role: "USER" | "Q",
  content: string,
  blocks?: QConversationMessage["blocks"],
): QConversationMessage =>
  ({
    id,
    tenantId: "t",
    conversationId: "c",
    runId,
    role,
    content,
    contentType: "TEXT",
    ...(blocks === undefined ? {} : { blocks }),
  }) as unknown as QConversationMessage;

const sourceBlock = {
  kind: "PUBLIC_SOURCE",
  url: "https://techcabal.com/2025/11/14/paystack-suspends-ezra-olubi/",
  domain: "techcabal.com",
  title: "Paystack suspends co-founder",
  publishedOn: "2025-11-14",
  retrievedOn: "2026-11-12",
} as const;

const history: QConversationMessage[] = [
  message("m1", "r1", "USER", "What does the public web say about Paystack?"),
  message("m2", "r1", "Q", "Here is what public pages say…", [sourceBlock]),
];

const research = (
  runId: string,
  sources: readonly Record<string, unknown>[],
  entityName = "Paystack",
): QConversationFetch => ({
  runId,
  toolName: "public_web.search",
  arguments: { query: "paystack", entityName },
  result: { status: "OK", sources },
  sensitivity: "PUBLIC",
  fetchedAt: "2026-11-12T14:48:04Z",
});

const page = (url: string, extra: Record<string, unknown> = {}) => ({
  index: 1,
  url,
  domain: new URL(url).hostname.replace(/^www\./u, ""),
  title: `Title of ${url}`,
  publishedAt: null,
  retrievedAt: "2026-11-12T14:48:03Z",
  excerpt: "Paystack suspended its co-founder pending an investigation.",
  subjectMatch: "MATCH",
  ...extra,
});

describe("earlier research pages", () => {
  it("carries the recent research's pages, numbered apart, one per address", () => {
    const pages = earlierResearchPages({
      history,
      fetched: [
        research("r1", [
          page("https://techcabal.com/2025/11/14/x"),
          page("https://techcabal.com/2025/11/14/x"),
          page("https://www.hellopeter.com/paystack"),
          page("https://namesake.example/paystack-bus", {
            subjectMatch: "NONE",
          }),
          { url: "javascript:alert(1)", domain: "x", retrievedAt: "2026" },
        ]),
      ],
    });
    expect(pages.map((one) => [one.index, one.domain])).toEqual([
      [101, "techcabal.com"],
      [102, "hellopeter.com"],
    ]);
  });

  it("leaves out research from turns long past, and other tools", () => {
    const longer = [
      message("u0", "r0", "USER", "earlier"),
      message("q0", "r0", "Q", "old research"),
      message("u2", "r2", "USER", "a"),
      message("q2", "r2", "Q", "b"),
      message("u3", "r3", "USER", "c"),
      message("q3", "r3", "Q", "d"),
      message("u4", "r4", "USER", "e"),
      message("q4", "r4", "Q", "f"),
    ];
    expect(
      earlierResearchPages({
        history: longer,
        fetched: [
          research("r0", [page("https://old.example/a")]),
          {
            ...research("r4", [page("https://x.example/a")]),
            toolName: "company.get",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("hands the model the pages as fenced data, and they become citable", () => {
    const pages = earlierResearchPages({
      history,
      fetched: [research("r1", [page("https://techcabal.com/2025/11/14/x")])],
    });
    const note = earlierResearchNote(pages);
    expect(note?.content).toContain("[S101] techcabal.com");
    expect(note?.content).toContain("suspended its co-founder");
    expect(note?.content).toContain("UNTRUSTED_CONTENT");
    expect(earlierResearchNote([])).toBeNull();

    // A follow-up finding naming the site cites that earlier page, unverified.
    const blocks =
      analystResultBlocks({
        result: {
          answer: "The biggest risk is governance.",
          findings: [
            {
              statement: "Governance risk after the co-founder's suspension.",
              type: "RISK",
              basis: ["TechCabal reported the suspension"],
              truthClass: "UNKNOWN",
              evidenceStatus: "NO_EVIDENCE",
            },
          ],
        },
        subjects: [],
        supplied: publicStandingsOf(pages),
        findingId: () => "00000000-0000-4000-8000-000000000001",
      }) ?? [];
    const finding = blocks.find((block) => block.kind === "FINDING");
    expect(finding?.kind).toBe("FINDING");
    if (finding?.kind !== "FINDING") return;
    expect(finding.finding.truthClass).toBe("UNKNOWN");
    expect(finding.finding.citations?.[0]?.truthClass).toBe("UNKNOWN");
    expect(finding.finding.citations?.[0]?.source).toContain(
      "Public web: techcabal.com",
    );
  });

  it("knows whom the research was about", () => {
    expect(
      earlierResearchSubjects({
        history,
        fetched: [research("r1", [], "Paystack")],
      }),
    ).toEqual(["Paystack"]);
  });
});

describe("a follow-up answers from what was already read", () => {
  const follows = (question: string, aboutNamedOther = false) =>
    followsUpPublicSources({
      history,
      question,
      aboutNamedOther,
      researchedNames: ["Paystack"],
    });

  it("without a pronoun, and naming the same subject", () => {
    expect(follows("What are the biggest risks?")).toBe(true);
    expect(
      follows("How does that compare with what the founder told us?"),
    ).toBe(true);
    expect(follows("What are Paystack's biggest risks?", true)).toBe(true);
    // Live 12 Nov: the reader read "here" as Paystack.
    expect(
      followsUpPublicSources({
        history,
        question: "What are the biggest risks for an investor here?",
        aboutNamedOther: true,
        researchedNames: ["Paystack"],
        namedEntity: "Paystack",
      }),
    ).toBe(true);
    expect(
      followsUpPublicSources({
        history,
        question: "And them?",
        aboutNamedOther: true,
        researchedNames: ["Paystack"],
        namedEntity: "Flutterwave",
      }),
    ).toBe(false);
  });

  it("not when it names someone new, asks for newer news, or follows no research", () => {
    expect(follows("What about Flutterwave?", true)).toBe(false);
    expect(follows("Any news on them today?")).toBe(false);
    expect(follows("Check that again")).toBe(false);
    expect(
      followsUpPublicSources({
        history: [
          message("m1", "r1", "USER", "hi"),
          message("m2", "r1", "Q", "hello"),
        ],
        question: "What are the biggest risks?",
        aboutNamedOther: false,
      }),
    ).toBe(false);
  });
});
