import type {
  ModelAttribution,
  ModelBudget,
  ModelDataPosture,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  PITCH_SECTION_FACTS_MAX,
  PITCH_SECTION_TRANSCRIPT_MAX,
  PitchSectionExtractionResultSchema,
  renderPrompt,
  type PitchSectionExtractionResult,
  type PitchSectionExtractionVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * Q reads one pitch video's transcript into the founder profile's standard
 * sections (lane ov 2026-10-16), so a company's Overview fills from what
 * the founder says where the deck lacks a section. Its only input is that
 * pitch's own transcript (Context Firewall): nothing else Q knows about the
 * company reaches the reading, because everyone who may play the pitch may
 * later read it. The same extraction path as the deck reader: one
 * STRUCTURED_EXTRACTION call through the Model Gateway, validated output,
 * normalised by code. A failure is null; the Overview then shows the deck
 * and the founder's answers only.
 *
 * Every fact is the founder's own claim (USER_CLAIM, SELF_REPORTED) with
 * the moment it is said; the reader sets those labels, never the model.
 */

/** The prompt family version whose output is stored. */
export const PITCH_SECTION_READER_PROMPT_VERSION = 1;

/**
 * One call per pitch. A 3-minute pitch is ~3k input tokens with the prompt
 * and well under 1k output; the ceiling covers a ten-minute pitch.
 */
const BUDGET: ModelBudget = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.08,
  maxOutputTokens: 3_000,
  attemptTimeoutMs: 90_000,
};

export type PitchSectionSpec = {
  /** The key facts are filed under (the section's factKey, else its key). */
  readonly key: string;
  readonly title: string;
};

export type PitchCue = {
  readonly startMs: number;
  readonly text: string;
};

export type PitchSectionReadFact = {
  readonly label: string;
  readonly value: string;
  readonly atSeconds: number;
  readonly truthClass: "USER_CLAIM";
  readonly evidenceStatus: "SELF_REPORTED";
};

export type PitchSectionReading = readonly {
  readonly key: string;
  readonly facts: readonly PitchSectionReadFact[];
}[];

export type PitchSectionReader = {
  readonly read: (input: {
    readonly sections: readonly PitchSectionSpec[];
    readonly durationSeconds: number | null;
    readonly cues: readonly PitchCue[];
    readonly attribution: ModelAttribution;
  }) => Promise<PitchSectionReading | null>;
};

function moment(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
}

/** The transcript as sent: "[m:ss] words" per cue, in order, bounded. */
export function pitchTranscriptText(cues: readonly PitchCue[]): string {
  const lines: string[] = [];
  let length = 0;
  for (const cue of [...cues].sort((a, b) => a.startMs - b.startMs)) {
    const text = cue.text.replace(/\s+/gu, " ").trim();
    if (text.length === 0) continue;
    const line = `[${moment(cue.startMs)}] ${text}`;
    if (length + line.length + 1 > PITCH_SECTION_TRANSCRIPT_MAX) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

/** Digits as written, without separators: "1,200" and "1200" are one. */
function figures(text: string): readonly string[] {
  return [
    ...text
      .replace(/(?<=\d)[,\s](?=\d{3}\b)/gu, "")
      .matchAll(/\d+(?:\.\d+)?/gu),
  ].map((match) => match[0]);
}

/**
 * Whatever the model returned, kept only where it is true to the input:
 * a key the section list has (first entry wins), a moment inside the
 * pitch, and no figure the transcript never says (a misheard or invented
 * number is dropped, never shown as the founder's). Sections in the list's
 * order; a section with nothing left is left out (unknown stays unknown).
 */
export function normalisePitchSectionReading(
  result: PitchSectionExtractionResult,
  sections: readonly PitchSectionSpec[],
  cues: readonly PitchCue[],
): PitchSectionReading {
  const said = new Set(figures(cues.map((cue) => cue.text).join(" ")));
  const lastSecond =
    cues.reduce((most, cue) => Math.max(most, cue.startMs), 0) / 1000;
  const out: { key: string; facts: PitchSectionReadFact[] }[] = [];
  for (const spec of sections) {
    const found = result.sections.find((section) => section.key === spec.key);
    if (found === undefined) continue;
    const facts = found.facts
      .filter(
        (fact) =>
          fact.atSeconds <= lastSecond + 1 &&
          figures(fact.value).every((figure) => said.has(figure)),
      )
      .slice(0, PITCH_SECTION_FACTS_MAX)
      .map((fact) => ({
        label: fact.label,
        value: fact.value,
        atSeconds: fact.atSeconds,
        truthClass: "USER_CLAIM" as const,
        evidenceStatus: "SELF_REPORTED" as const,
      }));
    if (facts.length > 0) out.push({ key: spec.key, facts });
  }
  return out;
}

export function createPitchSectionReader(dependencies: {
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  /** Doc 15 §62: absent is REAL_CUSTOMER. */
  readonly dataPosture?: ModelDataPosture | undefined;
}): PitchSectionReader {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return {
    read: async (input) => {
      const transcript = pitchTranscriptText(input.cues);
      if (transcript.length === 0 || input.sections.length === 0) return null;
      const variables: Omit<
        PitchSectionExtractionVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        sections: input.sections
          .map((section) => `${section.key}: ${section.title}`)
          .join("\n"),
        durationSeconds: input.durationSeconds,
        transcript,
      };
      try {
        const rendered = renderPrompt<PitchSectionExtractionVariables>(
          registry,
          {
            task: "PITCH_SECTION_EXTRACTION",
            operatingMode: "ASSESSMENT",
            communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
            environmentNotes:
              "You file what a founder says in their pitch video into their profile's sections; everyone who may play the pitch may read it, labelled as the founder's claim.",
            variables,
          },
        );
        const response = await gateway.execute<PitchSectionExtractionResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            reasoning: "LOW",
            // A founder's pitch: never to a provider ineligible for it.
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          { schema: PitchSectionExtractionResultSchema },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = PitchSectionExtractionResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        return parsed.success
          ? normalisePitchSectionReading(
              parsed.data,
              input.sections,
              input.cues,
            )
          : null;
      } catch (error: unknown) {
        logger.warn({ err: error }, "a pitch transcript was not read");
        return null;
      }
    },
  };
}
