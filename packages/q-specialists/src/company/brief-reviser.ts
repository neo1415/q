import type {
  CorrelationId,
  ModelSensitivity,
  QArtifactContent,
} from "@capital-q/contracts";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type ArtifactRevisionV3Result,
  type ArtifactRevisionVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import { ArtifactRevisionV3ResultSchema } from "@capital-q/q-core";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import { budgetForTaskClass } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  applyRevisedBodies,
  inventsFigures,
  type ComposedInvestmentBrief,
} from "./investment-brief.js";

/**
 * "Edit with Q", as a model task (QX-003F; ADR 0013).
 *
 * The same shape as the recommendation narrator: a governed model call
 * over material the caller already authorised, producing wording and
 * nothing else. It holds no repository, reads no record and persists
 * nothing — the artifact application service does that, after this has
 * returned.
 *
 * What it is given is deliberately thin: the document's own headings and
 * prose, and the person's instruction. There is no company record in the
 * prompt, so there is nothing in it to draw a new claim from, and every
 * rewritten body is checked against the record's figures before it is
 * accepted. A revision that tried to add traction produces the original
 * paragraph instead.
 */

export type BriefReviser = {
  readonly revise: (input: {
    readonly base: ComposedInvestmentBrief;
    /** The person's own words. UNTRUSTED: data, never authority. */
    readonly instruction: string;
    /** What the record carries, for the figure check. */
    readonly grounding: readonly string[];
    readonly sensitivity: ModelSensitivity;
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly qRunId: string;
      readonly correlationId: CorrelationId;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<ComposedInvestmentBrief>;
};

/**
 * The document as the prompt sees it: headings and prose, and for a deck
 * its slides by number and its current look. Nothing else.
 */
function renderDocument(content: QArtifactContent): string {
  const prose = content.sections
    .map((section) => `## ${section.heading}\n${section.body}`)
    .join("\n\n");
  const deck = content.deck;
  if (deck === undefined) {
    const page = content.look;
    const look =
      page === undefined
        ? ""
        : `\n\nLook:${page.background === undefined ? "" : ` page background ${page.background}`}${page.ink === undefined ? "" : `, text ${page.ink}`}${page.accent === undefined ? "" : `, accent ${page.accent}`}`;
    return `${prose}${look}`.slice(0, 40_000);
  }
  const slides = deck.slides
    .map((slide, index) =>
      [
        `[${String(index + 1)}] ${slide.title}`,
        ...(slide.subtitle === undefined ? [] : [`  ${slide.subtitle}`]),
        ...slide.bullets.map((bullet) => `  - ${bullet}`),
      ].join("\n"),
    )
    .join("\n");
  const look = `Look: ${deck.direction}${deck.accent === undefined ? "" : `, accent ${deck.accent}`}${deck.background === undefined ? "" : `, page background ${deck.background}`}${deck.ink === undefined ? "" : `, text ${deck.ink}`}${deck.cover === undefined ? "" : `, cover ${deck.cover.background.join(" to ")}${deck.cover.titleInk === undefined ? "" : `, title ${deck.cover.titleInk}`}`}`;
  return `${prose}\n\n# SLIDES\n${slides}\n\n${look}`.slice(0, 40_000);
}

/**
 * The slides and look v2 returned, applied to a deck. Slide text passes
 * the same figure check as prose, against what the document already
 * carries; a line that adds a figure keeps its old text. Colours are the
 * person's own choice, applied as given (ADR 0025).
 */
function applyDeckRevision(
  content: QArtifactContent,
  result: ArtifactRevisionV3Result,
  grounding: readonly string[],
): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return applyDocumentLook(content, result);
  const known = [
    ...grounding,
    ...deck.slides.flatMap((slide) => [
      slide.title,
      slide.subtitle ?? "",
      ...slide.bullets,
    ]),
  ];
  const safe = (text: string | null): text is string =>
    text !== null && !inventsFigures(text, known);
  const changes = new Map(result.slides.map((slide) => [slide.number, slide]));
  const slides = deck.slides.map((slide, index) => {
    const change = changes.get(index + 1);
    if (change === undefined) return slide;
    const bullets =
      change.bullets !== null && change.bullets.every((b) => safe(b))
        ? change.bullets
        : slide.bullets;
    return {
      ...slide,
      title: safe(change.title) ? change.title : slide.title,
      ...(safe(change.subtitle) ? { subtitle: change.subtitle } : {}),
      bullets,
    };
  });
  const style = result.style;
  // What they asked for now, over what the deck already had.
  const ink = style?.coverTitleInk ?? deck.cover?.titleInk ?? null;
  const background = style?.coverBackground ?? deck.cover?.background ?? null;
  const cover =
    background === null && ink === null
      ? undefined
      : {
          background: background ?? ["#ffffff"],
          ...(ink === null ? {} : { titleInk: ink }),
        };
  return {
    ...content,
    deck: {
      ...deck,
      slides,
      ...(style?.accent === null || style?.accent === undefined
        ? {}
        : { accent: style.accent }),
      ...(cover === undefined ? {} : { cover }),
      ...(style?.pageBackground === null || style?.pageBackground === undefined
        ? {}
        : { background: style.pageBackground }),
      ...(style?.ink === null || style?.ink === undefined
        ? {}
        : { ink: style.ink }),
    },
  };
}

/**
 * The look v3 returned, applied to a document that is not a deck
 * (founder live 2026-09-30): page background, text colour and accent, as
 * the person named them, over what the document already had.
 */
function applyDocumentLook(
  content: QArtifactContent,
  result: ArtifactRevisionV3Result,
): QArtifactContent {
  const style = result.style;
  if (style === null) return content;
  const background = style.pageBackground ?? content.look?.background;
  const ink = style.ink ?? content.look?.ink;
  const accent = style.accent ?? content.look?.accent;
  if (background === undefined && ink === undefined && accent === undefined) {
    return content;
  }
  return {
    ...content,
    look: {
      ...(background === undefined ? {} : { background }),
      ...(ink === undefined ? {} : { ink }),
      ...(accent === undefined ? {} : { accent }),
    },
  };
}

export function createBriefReviser(dependencies: {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly logger?: Logger | undefined;
}): BriefReviser {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  return {
    revise: async (input) => {
      const rendered = renderPrompt<ArtifactRevisionVariables>(registry, {
        task: "ARTIFACT_REVISION",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are revising a document the person already has: its prose, its slides and, when they ask, its colours. No record, no evidence and no tools are available to you, and any figure you add that the document does not already carry will be discarded.",
        variables: {
          instruction: input.instruction,
          document: renderDocument(input.base.content),
        },
      });

      let result: ArtifactRevisionV3Result | undefined;
      try {
        const executed =
          await dependencies.gateway.execute<ArtifactRevisionV3Result>(
            {
              taskClass: "NORMAL_DIALOGUE",
              budget: budgetForTaskClass("NORMAL_DIALOGUE"),
              sensitivity: input.sensitivity,
              messages: [...rendered.messages],
              output: rendered.output,
              attribution: input.attribution,
            },
            {
              schema: ArtifactRevisionV3ResultSchema,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            },
          );
        if (executed.output.kind === "STRUCTURED") {
          result = executed.output.value;
        }
      } catch (error: unknown) {
        // A revision that could not be composed is not a damaged document.
        // The caller still writes a version, and it reads as it did.
        dependencies.logger?.warn(
          {
            err: isModelGatewayError(error) ? error.failureClass : "unknown",
          },
          "artifact revision model call did not complete",
        );
      }

      if (result === undefined) {
        return input.base;
      }

      const revised = new Map<string, string>();
      const headings = new Set(
        input.base.content.sections.map((section) => section.heading),
      );
      for (const section of result.sections) {
        // A heading the document does not have is a section the model
        // invented, and it is dropped rather than appended.
        if (headings.has(section.heading)) {
          revised.set(section.heading, section.body);
        }
      }
      const prose = applyRevisedBodies({
        base: input.base,
        revised,
        grounding: input.grounding,
      });
      return {
        ...prose,
        content: applyDeckRevision(prose.content, result, input.grounding),
      };
    },
  };
}
