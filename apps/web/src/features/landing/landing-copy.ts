import {
  richTextPlain,
  type PublicSiteLandingDto,
  type SiteBlock,
} from "@capital-q/contracts";

import {
  CONVERGE,
  FAQ,
  GATEQ_ANCHOR,
  HERO,
  SIGN_UP_HREF,
} from "./landing-content";

/**
 * The landing page's words, from the content editor's published landing
 * sections (decision 107) where they exist, and today's hard-coded copy
 * where they do not. The illustrations and their fictional data stay in
 * code (landing-content.ts); only headings, ledes, buttons, the questions
 * and the footer lines are editable. A section that is unpublished,
 * missing or malformed falls back silently, so the page never breaks.
 */

export type LandingHead = { readonly title: string; readonly lede: string };
export type LandingLink = { readonly label: string; readonly href: string };

export type LandingCopy = {
  readonly fromCms: boolean;
  readonly hero: LandingHead & {
    readonly primary: LandingLink;
    readonly secondary: LandingLink;
  };
  readonly converge: {
    readonly before: LandingHead;
    readonly after: LandingHead;
  };
  readonly how: LandingHead;
  readonly trust: LandingHead;
  readonly steps: LandingHead;
  readonly gateq: LandingHead;
  readonly rehearsal: LandingHead;
  readonly leads: LandingHead;
  readonly questions: {
    readonly title: string;
    readonly items: readonly (readonly [question: string, answer: string])[];
  };
  readonly final: LandingHead & {
    readonly primary: LandingLink;
    readonly secondary: LandingLink;
  };
  readonly footer: readonly string[];
};

export const DEFAULT_LANDING_COPY: LandingCopy = {
  fromCms: false,
  hero: {
    ...HERO,
    primary: { label: "Get started", href: SIGN_UP_HREF },
    secondary: { label: "Try GateQ", href: `#${GATEQ_ANCHOR}` },
  },
  converge: CONVERGE,
  how: {
    title: "Say it once. Approve what Q prepares.",
    lede: "Q shows exactly what will be sent, and to whom. Nothing leaves until you approve that exact message.",
  },
  trust: {
    title: "Built so you can trust what you see.",
    lede: "Q does the analysis. You make the decisions. Capital Q keeps the rules.",
  },
  steps: { title: "Three steps. Q does the reading.", lede: "" },
  gateq: {
    title: "Try GateQ: am I a fit?",
    lede: "Check yourself against a fictional investor. Skip anything you like; unknown is not a no.",
  },
  rehearsal: {
    title: "Rehearse the call before it counts.",
    lede: "Pitch out loud to Q. It listens, pushes back, and reviews you afterwards.",
  },
  leads: {
    title: "Where it leads.",
    lede: "Not months of outreach to investors who were never a fit. Not a message you never saw.",
  },
  questions: { title: "Questions.", items: FAQ },
  final: {
    title: "Bring the evidence. Q does the rest.",
    lede: "With your approval, every time.",
    primary: { label: "Get started", href: SIGN_UP_HREF },
    secondary: { label: "Try GateQ", href: `#${GATEQ_ANCHOR}` },
  },
  footer: [
    "Capital Q. Investment intelligence for private capital.",
    "Illustrations use fictional names.",
  ],
};

const firstHeading = (blocks: readonly SiteBlock[], level?: number) =>
  blocks.find(
    (b): b is Extract<SiteBlock, { type: "heading" }> =>
      b.type === "heading" && (level === undefined || b.level === level),
  )?.text ?? null;

const firstParagraph = (blocks: readonly SiteBlock[]) => {
  for (const block of blocks) {
    if (block.type !== "richText") continue;
    const node = block.content.find((n) => n.kind === "paragraph");
    if (node !== undefined && node.kind === "paragraph") {
      return node.spans.map((s) => s.text).join("");
    }
  }
  return null;
};

function headOf(
  blocks: readonly SiteBlock[] | undefined,
  fallback: LandingHead,
): LandingHead {
  if (blocks === undefined) return fallback;
  return {
    title: firstHeading(blocks, 1) ?? fallback.title,
    lede: firstParagraph(blocks) ?? fallback.lede,
  };
}

function buttonsOf(
  blocks: readonly SiteBlock[] | undefined,
  fallback: readonly [LandingLink, LandingLink],
): readonly [LandingLink, LandingLink] {
  const buttons = (blocks ?? []).filter(
    (b): b is Extract<SiteBlock, { type: "button" }> => b.type === "button",
  );
  return [
    buttons[0] === undefined
      ? fallback[0]
      : { label: buttons[0].label, href: buttons[0].href },
    buttons[1] === undefined
      ? fallback[1]
      : { label: buttons[1].label, href: buttons[1].href },
  ];
}

/** Paired heading-then-answer blocks: the landing's short FAQ. */
function questionsOf(blocks: readonly SiteBlock[]) {
  const items: [string, string][] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const next = blocks[i + 1];
    if (
      block?.type === "heading" &&
      block.level >= 2 &&
      next?.type === "richText"
    ) {
      items.push([block.text, richTextPlain(next.content)]);
    }
    if (block?.type === "faq") {
      for (const item of block.items) {
        items.push([item.question, richTextPlain(item.answer)]);
      }
    }
  }
  return items;
}

export function landingCopyFrom(
  landing: PublicSiteLandingDto | null,
): LandingCopy {
  if (landing === null || landing.sections.length === 0) {
    return DEFAULT_LANDING_COPY;
  }
  const d = DEFAULT_LANDING_COPY;
  const by = new Map(landing.sections.map((s) => [s.slug, s.blocks]));
  const hero = by.get("landing-hero");
  const [heroPrimary, heroSecondary] = buttonsOf(hero, [
    d.hero.primary,
    d.hero.secondary,
  ]);
  const final = by.get("landing-final-cta");
  const [finalPrimary, finalSecondary] = buttonsOf(final, [
    d.final.primary,
    d.final.secondary,
  ]);
  const converge = by.get("landing-converge");
  const convergeHeads = (converge ?? []).filter(
    (b): b is Extract<SiteBlock, { type: "heading" }> =>
      b.type === "heading" && b.level === 3,
  );
  const convergeLedes = (converge ?? []).flatMap((b) =>
    b.type === "richText" ? [richTextPlain(b.content)] : [],
  );
  const questions = by.get("landing-questions");
  const questionItems = questions === undefined ? [] : questionsOf(questions);
  const footer = by.get("landing-footer");
  const footerLines =
    footer
      ?.find((b) => b.type === "richText")
      ?.content.flatMap((node) =>
        node.kind === "paragraph"
          ? [node.spans.map((s) => s.text).join("")]
          : [],
      ) ?? [];
  return {
    fromCms: true,
    hero: {
      ...headOf(hero, d.hero),
      primary: heroPrimary,
      secondary: heroSecondary,
    },
    converge: {
      before: {
        title: convergeHeads[0]?.text ?? d.converge.before.title,
        lede: convergeLedes[0] ?? d.converge.before.lede,
      },
      after: {
        title: convergeHeads[1]?.text ?? d.converge.after.title,
        lede: convergeLedes[1] ?? d.converge.after.lede,
      },
    },
    how: headOf(by.get("landing-how-q-works"), d.how),
    trust: headOf(by.get("landing-trust"), d.trust),
    steps: headOf(by.get("landing-three-steps"), d.steps),
    gateq: headOf(by.get("landing-gateq"), d.gateq),
    rehearsal: headOf(by.get("landing-rehearsal"), d.rehearsal),
    leads: headOf(by.get("landing-where-it-leads"), d.leads),
    questions: {
      title:
        (questions === undefined ? null : firstHeading(questions, 1)) ??
        d.questions.title,
      items: questionItems.length === 0 ? d.questions.items : questionItems,
    },
    final: {
      ...headOf(final, d.final),
      primary: finalPrimary,
      secondary: finalSecondary,
    },
    footer: footerLines.length === 0 ? d.footer : footerLines,
  };
}
