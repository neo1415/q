import type { ReadinessDto } from "@capital-q/contracts";

/**
 * A founder's first answer on Home after onboarding (coordinator 25 Oct,
 * fresh-account run: Home said only "Welcome back, Abena. What's on your
 * mind today?"). Q leads with what it already knows: where they stand,
 * the gaps, the one thing to do next and what Q is working on.
 *
 * Pure and deterministic, from the stored readiness assessment and the
 * jobs read; nothing is composed by a model and nothing is claimed that
 * those records do not hold. An area not assessed is "not shared yet",
 * never a gap or a zero.
 */
export type FounderStart = {
  readonly areas: {
    readonly total: number;
    readonly strong: number;
    readonly developing: number;
    readonly gap: number;
    readonly unknown: number;
  };
  /** The assessment's blockers, by their own titles; at most three. */
  readonly gaps: readonly string[];
  /** The first open action, most urgent first; null: none open. */
  readonly next: {
    readonly title: string;
    readonly href: string | null;
  } | null;
  /** Q's jobs still being planned or run, by their goals; at most two. */
  readonly working: readonly string[];
};

const PRIORITY = { NOW: 0, NEXT: 1, LATER: 2 } as const;

export function founderStartOf(
  readiness: ReadinessDto | null,
  jobs: readonly { readonly status: string; readonly goal: string }[],
): FounderStart | null {
  if (readiness === null) return null;
  const count = (status: string) =>
    readiness.pillars.filter((pillar) => pillar.status === status).length;
  const next =
    [...readiness.actions]
      .filter((action) => action.state === "OPEN")
      .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority])[0] ?? null;
  return {
    areas: {
      total: readiness.pillars.length,
      strong: count("STRONG"),
      developing: count("DEVELOPING"),
      gap: count("GAP"),
      unknown: count("UNKNOWN"),
    },
    gaps: readiness.blockers.slice(0, 3).map((blocker) => blocker.title),
    next:
      next === null
        ? null
        : { title: next.title.replace(/[.\s]+$/u, ""), href: next.href },
    working: jobs
      .filter((job) => job.status === "PLANNING" || job.status === "RUNNING")
      .slice(0, 2)
      .map((job) =>
        job.goal
          .trim()
          .replace(/[.\s]+$/u, "")
          .slice(0, 120),
      )
      .filter((goal) => goal.length > 0),
  };
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/** The first answer's lines, in the order Q says them. */
export function founderStartLines(start: FounderStart): readonly string[] {
  const { areas } = start;
  const lines: string[] = [];
  if (areas.total === 0 || areas.unknown === areas.total) {
    lines.push(
      "I haven't been able to assess your readiness yet: nothing investors look at is shared so far.",
    );
  } else {
    const parts = [
      areas.strong > 0 ? `${String(areas.strong)} strong` : null,
      areas.developing > 0 ? `${String(areas.developing)} developing` : null,
      areas.gap > 0
        ? `${String(areas.gap)} with ${areas.gap === 1 ? "a gap" : "gaps"}`
        : null,
      areas.unknown > 0 ? `${String(areas.unknown)} not shared yet` : null,
    ].filter((part): part is string => part !== null);
    lines.push(
      `Here's where you stand across the ${String(areas.total)} areas investors look at: ${listed(parts)}.`,
    );
  }
  if (start.gaps.length > 0) {
    lines.push(
      `${start.gaps.length === 1 ? "The gap" : "The gaps"} to close first: ${listed(start.gaps.map((gap) => gap.replace(/[.\s]+$/u, "")))}.`,
    );
  }
  if (start.next !== null) {
    lines.push(`The one thing to do next: ${start.next.title}.`);
  }
  if (start.working.length > 0) {
    lines.push(`What I'm working on: ${listed(start.working)}.`);
  }
  return lines;
}
