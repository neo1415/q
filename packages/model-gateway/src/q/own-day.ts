import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * Their day, read for them on every turn (founder demo 2026-10-02: "what
 * are my tasks for today?" got "I don't have a current task list" and put
 * today's 12:30 call tomorrow; "how have I been doing in my rehearsals?"
 * got "no rehearsal results available" with four finished). Built from
 * their own records only -- list_schedule, list_pending_approvals,
 * list_q_work (each read through the tool under the run's plan) and their
 * own finished rehearsals -- with "now" in their zone. Bounded.
 */

export type OwnRehearsal = {
  readonly withName: string;
  readonly endedAt: string | null;
  readonly score: number | null;
  readonly outcome: string | null;
  readonly overall: string | null;
  readonly tip: string | null;
};

type Schedule = {
  readonly meetings?: readonly {
    readonly purpose?: unknown;
    readonly startsAt?: unknown;
    readonly with?: readonly unknown[];
  }[];
  readonly reminders?: readonly {
    readonly title?: unknown;
    readonly dueAt?: unknown;
  }[];
};
type Approvals = { readonly items?: readonly { readonly summary?: unknown }[] };
type Work = {
  readonly items?: readonly {
    readonly kind?: unknown;
    readonly status?: unknown;
    readonly lanes?: readonly {
      readonly counterpartName?: unknown;
      readonly stage?: unknown;
    }[];
  }[];
  readonly errands?: readonly {
    readonly counterpartName?: unknown;
    readonly status?: unknown;
  }[];
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function inZone(iso: string, zone: string | null, withDay: boolean): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone ?? "UTC",
      ...(withDay ? { weekday: "short", day: "numeric", month: "short" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return iso;
  }
}

function dayKey(at: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function ownDayFact(input: {
  readonly now: Date;
  /** Their zone (profile, else a trusted device zone); null when unknown. */
  readonly timeZone: string | null;
  readonly schedule: unknown;
  readonly approvals: unknown;
  readonly work: unknown;
  readonly rehearsals: readonly OwnRehearsal[];
}): AuthorisedFact {
  const zone = input.timeZone;
  const label = zone ?? "UTC (their own time zone is not known)";
  const parts: string[] = [
    `Now for them: ${inZone(input.now.toISOString(), zone, true)} ${label}.`,
  ];
  const today = dayKey(input.now, zone ?? "UTC");
  const horizon = input.now.getTime() + 8 * 24 * 3_600_000;
  const when = (iso: string) => {
    const at = new Date(iso);
    const isToday =
      !Number.isNaN(at.getTime()) && dayKey(at, zone ?? "UTC") === today;
    return isToday
      ? `today ${inZone(iso, zone, false)}`
      : inZone(iso, zone, true);
  };
  const soon = (iso: unknown) => {
    if (typeof iso !== "string") return false;
    const t = new Date(iso).getTime();
    return (
      !Number.isNaN(t) && t >= input.now.getTime() - 3_600_000 && t <= horizon
    );
  };

  const schedule = (input.schedule ?? {}) as Schedule;
  const calls = (schedule.meetings ?? [])
    .filter((m) => soon(m.startsAt))
    .slice(0, 8)
    .map((m) => {
      const who = (m.with ?? [])
        .map(text)
        .filter((w): w is string => w !== null);
      return `${when(String(m.startsAt))}: ${text(m.purpose) ?? "call"}${who.length === 0 ? "" : ` with ${who.slice(0, 3).join(", ")}`}`;
    });
  parts.push(
    calls.length === 0
      ? "Calls in the next 7 days: none booked."
      : `Calls in the next 7 days: ${calls.join("; ")}.`,
  );
  const reminders = (schedule.reminders ?? [])
    .filter(
      (r) =>
        typeof r.dueAt === "string" && new Date(r.dueAt).getTime() <= horizon,
    )
    .slice(0, 8)
    .map((r) => `${when(String(r.dueAt))}: ${text(r.title) ?? "reminder"}`);
  parts.push(
    reminders.length === 0
      ? "Open reminders due in the next 7 days: none."
      : `Open reminders (due, in their time): ${reminders.join("; ")}.`,
  );
  const approvals = ((input.approvals ?? {}) as Approvals).items ?? [];
  parts.push(
    approvals.length === 0
      ? "Waiting for their approval: nothing."
      : `Waiting for their approval (${String(approvals.length)}): ${approvals
          .slice(0, 5)
          .map((a) => text(a.summary) ?? "a change")
          .join("; ")}.`,
  );
  const work = (input.work ?? {}) as Work;
  const active = [
    ...(work.items ?? []).flatMap((item) =>
      (item.lanes ?? [])
        .slice(0, 4)
        .map(
          (lane) =>
            `${text(lane.counterpartName) ?? "someone"} (${text(lane.stage) ?? text(item.status) ?? "in progress"})`,
        ),
    ),
    ...(work.errands ?? []).map(
      (e) =>
        `${text(e.counterpartName) ?? "someone"} (${text(e.status) ?? "in progress"})`,
    ),
  ].slice(0, 8);
  parts.push(
    active.length === 0
      ? "Q working for them right now: nothing."
      : `Q working for them right now: ${active.join("; ")}.`,
  );
  const rehearsals = input.rehearsals.slice(0, 3).map((r) => {
    const bits = [
      r.endedAt === null ? null : inZone(r.endedAt, zone, true),
      r.score === null ? null : `score ${String(r.score)}/100`,
      r.outcome === null ? null : `outcome ${r.outcome.toLowerCase()}`,
    ].filter((b): b is string => b !== null);
    return `with ${r.withName} (${bits.join(", ")})${r.overall === null ? "" : `: ${r.overall.slice(0, 300)}`}${r.tip === null ? "" : ` Top tip: ${r.tip.slice(0, 240)}`}`;
  });
  parts.push(
    rehearsals.length === 0
      ? "Rehearsals finished: none yet."
      : `Their last rehearsals, newest first: ${rehearsals.join(" | ")}`,
  );
  return {
    scope: "OWN_DAY",
    statement:
      `Their own day and record on Capital Q (read for them this turn). ${parts.join(" ")}`.slice(
        0,
        4_000,
      ),
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source: "Capital Q schedule, approvals, Q work and rehearsals",
  };
}
