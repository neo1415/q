import { QPictureBlockSchema } from "@capital-q/contracts";
import { pictureBlock, type QPictureBlock } from "@capital-q/model-gateway/q";
import { CompanyAnalystV26ResultSchema } from "@capital-q/q-core";

import type { PictureScenario } from "./scenarios.js";

/**
 * Grades a COMPANY_ANALYST v26 answer for one picture scenario. Code over
 * the answer and what the real `pictureBlock` does with it, never an LLM
 * judge.
 *
 * `outbound` here is a stand-in for q-research's egress composer (the
 * authority, tested in apps/q-api q-pictures.test.ts): the proposal's
 * words that the person wrote, figures removed. It measures how much of a
 * model's proposal survives; it enforces nothing.
 */

export type PictureCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string | undefined;
};

export type PictureGrade = {
  readonly scenarioId: string;
  /** 0-100, share of checks passed. */
  readonly score: number;
  readonly checks: readonly PictureCheck[];
  /** The words that would have left Capital Q, or null when nothing was searched. */
  readonly sent: string | null;
  readonly shown: QPictureBlock | null;
};

const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];

const FIGURE = /\d/u;

/** A picture used as support for a claim, which it never is. */
const PICTURE_AS_EVIDENCE =
  /\b(?:the|this|that) (?:picture|photo|image) (?:shows|proves|confirms|is evidence)|\bas (?:you can see|shown) in the (?:picture|photo|image)/iu;

export function outbound(
  proposal: string,
  scenario: Pick<PictureScenario, "userText" | "earlierUserText">,
): string | null {
  const theirs = new Set(
    [scenario.userText, ...scenario.earlierUserText].flatMap(words),
  );
  const kept = words(proposal).filter(
    (word) => theirs.has(word) && !FIGURE.test(word),
  );
  return kept.length === 0 ? null : kept.join(" ");
}

export async function gradePicture(
  scenario: PictureScenario,
  answer: unknown,
): Promise<PictureGrade> {
  const checks: PictureCheck[] = [];
  const parsed = CompanyAnalystV26ResultSchema.safeParse(answer);
  checks.push({ name: "v26 result schema", ok: parsed.success });
  if (!parsed.success) {
    return {
      scenarioId: scenario.id,
      score: 0,
      checks,
      sent: null,
      shown: null,
    };
  }
  const result = parsed.data;
  const asked = result.visual === "PICTURE";
  const query = result.pictureQuery?.trim() ?? "";

  checks.push({
    name: "the answer is complete in words",
    ok: result.answer.trim().length >= 20,
  });
  checks.push({
    name: "a picture is never evidence",
    ok: !PICTURE_AS_EVIDENCE.test(result.answer),
  });
  if (scenario.picture === "WANTED") {
    checks.push({ name: "asks for a picture", ok: asked && query.length > 0 });
  }
  if (scenario.picture === "NONE") {
    checks.push({ name: "asks for no picture", ok: !asked });
  }
  if (asked && query.length > 0) {
    const count = words(query).length;
    checks.push({
      name: "a few plain words",
      ok: count >= 1 && count <= 4,
      detail: query,
    });
    checks.push({ name: "no figures in the words", ok: !FIGURE.test(query) });
    const lower = query.toLowerCase();
    checks.push({
      name: "no names in the words",
      ok: scenario.names.every((name) => !lower.includes(name.toLowerCase())),
      detail: query,
    });
  }

  // Written by the port below, read after it returns.
  const search: { sent: string | null } = { sent: null };
  const shown = await pictureBlock({
    result,
    userText: scenario.userText,
    earlierUserText: scenario.earlierUserText,
    pictures: {
      find: (input) => {
        search.sent = outbound(input.requestedQuery, scenario);
        return Promise.resolve(search.sent === null ? null : scenario.found);
      },
    },
  });
  const { sent } = search;
  const outboundWords = sent ?? "";
  const theirs = new Set(
    [scenario.userText, ...scenario.earlierUserText].flatMap(words),
  );
  const qOnly = new Set(
    scenario.qSaid.flatMap(words).filter((word) => !theirs.has(word)),
  );
  checks.push({
    name: "only the person's words leave",
    ok: words(outboundWords).every((word) => !qOnly.has(word)),
    detail: outboundWords,
  });
  checks.push({
    name: "no name leaves",
    ok: scenario.names.every(
      (name) => !outboundWords.includes(name.toLowerCase()),
    ),
    detail: outboundWords,
  });
  if (scenario.picture === "WANTED" && asked) {
    checks.push({
      name: "the person's words find something to search",
      ok: sent !== null,
    });
  }
  if (shown !== null) {
    checks.push({
      name: "a shown picture is on its source's hosts, with credit",
      ok:
        QPictureBlockSchema.safeParse(shown).success &&
        shown.credit.name.trim().length > 0,
    });
  }
  const score = Math.round(
    (checks.filter((check) => check.ok).length / checks.length) * 100,
  );
  return { scenarioId: scenario.id, score, checks, sent, shown };
}
