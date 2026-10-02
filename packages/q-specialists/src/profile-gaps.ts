import { COMPANY_EDITABLE_FIELDS } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * Filling the open fields of their own profile, run by code (HARDEN P0,
 * live 2026-10-02, Nixo).
 *
 * "I need you to go online, search everything you can find, specifically
 * the answers to the open questions in my profile. I'm giving you full
 * permission and approval to update my profile with what you get online."
 * The answer model was offered fill_profile_gaps and never called it; it
 * lectured about verification instead. When the turn reader reads
 * saveToOwnProfile, this runs the job without the answer model:
 *
 *  1. fill_profile_gaps, first call: their own company's open fields, and
 *     public research for them (the tool's own rules and budget).
 *  2. A reader (STRUCTURED_EXTRACTION, a strict schema, never the analyst)
 *     maps the sources onto those fields, each value cited with the
 *     source's own words.
 *  3. Code keeps a value only when its quote is in a source it cites.
 *  4. fill_profile_gaps, second call: the tool's own filtering (open
 *     fields only, sources of this run only, conflicts dropped and named)
 *     and ONE combined change for approval.
 *
 * What Q says is the tool's line; the card follows the answer.
 */

export type ProfileGapSource = {
  readonly index: number;
  readonly url: string;
  readonly title: string | null;
  readonly excerpt: string;
};

export type ProfileGapReading = {
  readonly wrongSubject: boolean;
  readonly values: readonly {
    readonly field: string;
    readonly value: string;
    readonly sources: readonly number[];
    readonly quote: string;
  }[];
  readonly conflicting: readonly string[];
};

/** The constrained model step: sources onto open fields, nothing else. */
export type ProfileGapReader = (input: {
  readonly request: QAnswerRequest;
  readonly companyName: string;
  readonly openFields: readonly string[];
  readonly sources: readonly ProfileGapSource[];
}) => Promise<ProfileGapReading | null>;

export type QProfileGapsPort = {
  /**
   * The line Q says, or null when this does not apply (no company of
   * their own on this run, no public research granted): the turn is then
   * answered as before.
   */
  readonly fill: (
    request: QAnswerRequest,
  ) => Promise<{ readonly line: string } | null>;
};

const FILL = "fill_profile_gaps";
const FIELDS: ReadonlySet<string> = new Set(COMPANY_EDITABLE_FIELDS);

type GapsData = {
  readonly status: string;
  readonly companyName: string | null;
  readonly openFields: readonly string[];
  readonly sources: readonly ProfileGapSource[];
  readonly line: string;
};

function gapsData(data: unknown): GapsData | null {
  if (data === null || typeof data !== "object") return null;
  const value = data as Partial<Record<keyof GapsData, unknown>>;
  if (typeof value.status !== "string" || typeof value.line !== "string") {
    return null;
  }
  const openFields = Array.isArray(value.openFields)
    ? value.openFields.filter((f): f is string => typeof f === "string")
    : [];
  const sources = Array.isArray(value.sources)
    ? value.sources.flatMap((source: unknown) => {
        if (source === null || typeof source !== "object") return [];
        const s = source as Record<string, unknown>;
        return typeof s["index"] === "number" &&
          typeof s["url"] === "string" &&
          typeof s["excerpt"] === "string"
          ? [
              {
                index: s["index"],
                url: s["url"],
                title: typeof s["title"] === "string" ? s["title"] : null,
                excerpt: s["excerpt"],
              },
            ]
          : [];
      })
    : [];
  return {
    status: value.status,
    companyName:
      typeof value.companyName === "string" ? value.companyName : null,
    openFields,
    sources,
    line: value.line,
  };
}

const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function createToolProfileGapsPort(dependencies: {
  readonly tools: QToolPort;
  readonly read: ProfileGapReader;
  readonly logger?: Logger | undefined;
}): QProfileGapsPort {
  const { tools, read, logger } = dependencies;
  const call = async (
    request: QAnswerRequest,
    callId: string,
    args: Record<string, unknown>,
  ): Promise<GapsData | null> => {
    const outcome = await tools.execute(
      { callId, name: FILL, arguments: args },
      {
        actor: request.actor,
        runId: request.runId,
        correlationId: request.correlationId,
        capability: request.capability,
        plan: request.plan,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    if (outcome.status !== "SUCCEEDED" || !outcome.result.ok) {
      logger?.info(
        {
          qRunId: request.runId,
          status: outcome.status,
          failureCode: outcome.failureCode,
        },
        "fill_profile_gaps did not run for this turn",
      );
      return null;
    }
    return gapsData(outcome.result.data);
  };

  return {
    fill: async (request) => {
      const found = await call(request, "q-gaps-search", {});
      if (found === null) return null;
      if (found.status !== "RESEARCHED") {
        return found.line.length === 0 ? null : { line: found.line };
      }
      const open = found.openFields.filter((field) => FIELDS.has(field));
      const reading = await read({
        request,
        companyName: found.companyName ?? "",
        openFields: open,
        sources: found.sources,
      }).catch((error: unknown) => {
        logger?.warn(
          { err: error, qRunId: request.runId },
          "the profile gap reader produced nothing",
        );
        return null;
      });
      const byIndex = new Map(
        found.sources.map((source) => [source.index, normal(source.excerpt)]),
      );
      // A value stands only on a source's own words: the quote must be in
      // one of the sources it cites.
      const values =
        reading === null || reading.wrongSubject
          ? []
          : reading.values.filter(
              (entry) =>
                open.includes(entry.field) &&
                entry.sources.some((index) =>
                  (byIndex.get(index) ?? "").includes(normal(entry.quote)),
                ),
            );
      const conflicting =
        reading === null
          ? []
          : reading.conflicting.filter((field) => open.includes(field));
      logger?.info(
        {
          qRunId: request.runId,
          open: open.length,
          read: reading?.values.length ?? 0,
          kept: values.length,
          conflicting: conflicting.length,
        },
        "profile gaps mapped from public sources",
      );
      const filled = await call(request, "q-gaps-fill", {
        values: values.map((entry) => ({
          field: entry.field,
          value: entry.value,
          sources: [...entry.sources].slice(0, 5),
        })),
        conflicting,
      });
      const line = filled?.line ?? found.line;
      return line.length === 0 ? null : { line };
    },
  };
}
