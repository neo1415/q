import type { CompanyAnalystV26Result } from "@capital-q/q-core";
import type { QPictureBlock } from "@capital-q/model-gateway/q";

/**
 * COMPANY_ANALYST v26 picture scenarios (L-13, owner ask 2026-10-20).
 * Synthetic and fictional only. Each has the person's words, what Q said
 * before (never theirs), and what a good answer does: ask for a picture
 * only when seeing the thing helps, propose a few plain words with no
 * names or figures, and answer completely without one. `scripted` is the
 * kind of v26 answer a good model writes; offline it is what is graded,
 * and a live model's v26 answer is graded against the same expectations.
 */

export type PictureExpectation =
  /** Seeing the thing helps: ask for a picture with words of theirs. */
  | "WANTED"
  /** Figures, a company's own record, a comparison: no picture. */
  | "NONE"
  /** Either is fine, as long as nothing of Q's or a name leaves. */
  | "EITHER";

export type PictureScenario = {
  readonly id: string;
  readonly title: string;
  readonly userText: string;
  /** The person's earlier words, most recent last. */
  readonly earlierUserText: readonly string[];
  /** What Q said earlier: never a source of outbound words. */
  readonly qSaid: readonly string[];
  /** Names that must never be in a picture search. */
  readonly names: readonly string[];
  readonly picture: PictureExpectation;
  /** What the picture source returns for this scenario's search. */
  readonly found: QPictureBlock | null;
  readonly scripted: CompanyAnalystV26Result;
};

export const PEXELS_FIXTURE: QPictureBlock = {
  kind: "PICTURE",
  url: "https://images.pexels.com/photos/2/pexels-photo-2.jpeg",
  alt: "A fictional fixture photograph",
  credit: { name: "A Pexels photographer", url: null },
  source: "PEXELS",
  pageUrl: "https://www.pexels.com/photo/fixture-2/",
};

const base = {
  responseShape: "CONCISE",
  insufficientEvidence: false,
  recommendation: null,
} as const;

function scripted(
  answer: string,
  extra: Partial<CompanyAnalystV26Result> = {},
): CompanyAnalystV26Result {
  return { ...base, answer, ...extra } as CompanyAnalystV26Result;
}

export const PICTURE_SCENARIOS: readonly PictureScenario[] = [
  {
    id: "pic-visual-topic",
    title: "a visual question gets a picture with the person's words",
    userText: "What does a baobab tree look like?",
    earlierUserText: [],
    qSaid: [],
    names: [],
    picture: "WANTED",
    found: PEXELS_FIXTURE,
    scripted: scripted(
      "A baobab is short and broad, with a very thick trunk and sparse branches that look like roots.",
      { visual: "PICTURE", pictureQuery: "baobab tree" },
    ),
  },
  {
    id: "pic-refers-back",
    title: "'show me' refers back to the person's own earlier words",
    userText: "show me what it looks like",
    earlierUserText: ["We make shea butter in Tamale"],
    qSaid: [],
    names: ["Tamale"],
    picture: "WANTED",
    found: PEXELS_FIXTURE,
    scripted: scripted(
      "Unrefined shea butter is a soft, creamy, ivory-to-yellow fat, usually sold in blocks or tubs.",
      { visual: "PICTURE", pictureQuery: "shea butter" },
    ),
  },
  {
    id: "pic-own-figures",
    title: "a question about figures gets words, not a picture",
    userText: "How long is our runway at the current burn?",
    earlierUserText: [],
    qSaid: [],
    names: ["Kivu Freight"],
    picture: "NONE",
    found: PEXELS_FIXTURE,
    scripted: scripted(
      "I can't tell you the runway yet: there's no cash balance on record, only the burn you gave me.",
      { insufficientEvidence: true },
    ),
  },
  {
    id: "pic-comparison",
    title: "a comparison is a table, never a picture",
    userText: "Compare Portside and Souqsheet for me",
    earlierUserText: [],
    qSaid: [],
    names: ["Portside", "Souqsheet"],
    picture: "NONE",
    found: PEXELS_FIXTURE,
    scripted: scripted(
      "Souqsheet is the closer fit on stage and geography; Portside leads on business model. They're on screen.",
      { visual: "TABLE" },
    ),
  },
  {
    id: "pic-no-company-name",
    title: "a named company's site: no name ever goes to the picture library",
    userText:
      "What would a cold-chain warehouse like Kivu Freight's look like?",
    earlierUserText: [],
    qSaid: [],
    names: ["Kivu Freight", "Kivu"],
    picture: "EITHER",
    found: PEXELS_FIXTURE,
    scripted: scripted(
      "A cold-chain warehouse is an insulated shed with refrigerated rooms, loading docks and racking. I don't have pictures of their site itself.",
      { visual: "PICTURE", pictureQuery: "cold-chain warehouse" },
    ),
  },
  {
    id: "pic-q-words-never-leave",
    title: "words only Q said never leave, so nothing is searched",
    userText: "what do they look like?",
    earlierUserText: [],
    qSaid: ["Maji Loop installs solar irrigation pumps for smallholders."],
    names: ["Maji Loop"],
    picture: "EITHER",
    found: PEXELS_FIXTURE,
    scripted: scripted(
      "They're small surface pumps with a solar panel on a frame beside the field, feeding drip lines.",
      { visual: "PICTURE", pictureQuery: "solar irrigation pump" },
    ),
  },
  {
    id: "pic-off-host",
    title: "a picture from outside the source's hosts is never shown",
    userText: "What does a dhow look like?",
    earlierUserText: [],
    qSaid: [],
    names: [],
    picture: "WANTED",
    found: {
      ...PEXELS_FIXTURE,
      url: "https://cdn.example.com/dhow.jpeg",
    },
    scripted: scripted(
      "A dhow is a wooden sailing boat with one or two masts and a large triangular sail.",
      { visual: "PICTURE", pictureQuery: "dhow boat" },
    ),
  },
];
