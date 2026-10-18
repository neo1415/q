import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * The Q Daily on their screen, read for them before the model is asked
 * (founder live 2026-10-01: "summarize everything here" on the Daily was
 * answered from older conversation text; after the screen was named, Q
 * still said it did not have the edition's contents and never read it).
 * Built from get_q_daily's output: the headlines are each publisher's
 * report, and Q's take is Q's inference, said as such.
 */

type DailyRead = {
  readonly status?: unknown;
  readonly editionDate?: unknown;
  readonly number?: unknown;
  readonly headlines?: readonly {
    readonly section?: unknown;
    readonly headline?: unknown;
    readonly publisher?: unknown;
  }[];
  readonly qTake?: unknown;
  readonly nextDueAt?: unknown;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export function onScreenDailyFact(data: unknown): AuthorisedFact | null {
  if (typeof data !== "object" || data === null) return null;
  const read = data as DailyRead;
  const base = {
    scope: "OWN_Q_DAILY",
    // Publishers' reports and Q's own take, never verified fact.
    truthClass: "UNKNOWN" as const,
    evidenceStatus: "NO_EVIDENCE" as const,
    source: "The Q Daily (their edition)",
  };
  if (read.status === "OFF") {
    return {
      ...base,
      statement:
        "The Q Daily on their screen: they have turned The Q Daily off, so there is no edition to summarise.",
    };
  }
  if (read.status !== "READY") {
    const due = text(read.nextDueAt);
    return {
      ...base,
      statement: `The Q Daily on their screen: their first edition is still to come${due === null ? "" : ` (due ${due})`}.`,
    };
  }
  const lines = (read.headlines ?? [])
    .map((item) => {
      const headline = text(item.headline);
      if (headline === null) return null;
      const section = text(item.section);
      const publisher = text(item.publisher);
      return `${section === null ? "" : `[${section}] `}${headline}${publisher === null ? "" : ` (reported by ${publisher})`}`;
    })
    .filter((line): line is string => line !== null);
  const date = text(read.editionDate);
  const take = text(read.qTake);
  return {
    ...base,
    statement: `The Q Daily on their screen (the edition they mean by "here")${
      typeof read.number === "number" ? `, No. ${String(read.number)}` : ""
    }${date === null ? "" : `, ${date}`}: ${
      lines.length === 0 ? "no headlines." : lines.join("; ")
    }.${take === null ? "" : ` Q's take (Q's own inference, not reported fact): ${take}`}`.slice(
      0,
      3_000,
    ),
  };
}
