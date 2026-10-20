import {
  FIT_CONTEXT_SOURCE_LABELS,
  type FitProfileDto,
  type InterestDto,
  type QWorkDto,
  type RelationshipGateqApplicationsDto,
} from "@capital-q/contracts";

import {
  STAGE_WORDS,
  STATUS_WORDS,
  VERDICT,
  WORK_KIND_LABELS,
} from "@/features/work/work-words";

/**
 * The CRM record's own view model (owner directive 2026-10-15 §D, record
 * workspace): what the record says about Q's work with this counterpart,
 * and about fit and interest, kept as separate statements. Pure, so the
 * words and the joins are tested as such.
 *
 * Every join is by canonical id (a Q Work lane's counterpart id), never by
 * a name: two companies can share a name, and a name match would put
 * another record's work on this one.
 */

/** A read that answered, answered nothing, or could not be made. */
export type Read<T> =
  | { readonly kind: "READ"; readonly value: T }
  | { readonly kind: "UNAVAILABLE" };

export type RecordWorkRow = {
  readonly key: string;
  readonly title: string;
  /** Where the job stands overall, and this counterpart's stage within it. */
  readonly status: string;
  readonly stage: string;
  readonly href: string;
  /** Q's first-stage report on this counterpart, when written. */
  readonly report: {
    readonly headline: string;
    readonly verdict: string;
    readonly href: string;
  } | null;
  readonly updatedAt: string;
};

/** Q's jobs that have a lane for this counterpart, newest first. */
export function recordWork(
  items: readonly QWorkDto[],
  counterpartId: string,
): readonly RecordWorkRow[] {
  return items
    .flatMap((work) =>
      work.lanes
        .filter((lane) => lane.counterpart?.id === counterpartId)
        .map((lane): RecordWorkRow => ({
          key: `${work.id}:${lane.id}`,
          title: work.goal ?? WORK_KIND_LABELS[work.kind],
          status: STATUS_WORDS[work.status],
          stage: STAGE_WORDS[lane.stage],
          href: `/work/${work.id}`,
          report:
            lane.report === null
              ? null
              : {
                  headline: lane.report.headline,
                  verdict: VERDICT[lane.report.recommendation],
                  href: `/work/${work.id}/report/${lane.id}`,
                },
          updatedAt: lane.updatedAt,
        })),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The investor's own interest, in words. Interest is what the investor
 * did; it is never inferred from fit, viewing or Q's work.
 */
export function interestWords(
  interest: Read<InterestDto | null>,
  day: (iso: string) => string,
): string {
  if (interest.kind === "UNAVAILABLE") return "Couldn't be read right now";
  const value = interest.value;
  if (value === null) return "Not expressed";
  if (value.status === "WITHDRAWN") return "Withdrawn";
  const since = `Expressed ${day(value.expressedAt)}`;
  return value.response === "ACCEPTED"
    ? `${since} · they accepted`
    : value.response === "DECLINED"
      ? `${since} · they declined`
      : `${since} · awaiting their answer`;
}

/**
 * What the company stated about its round, from the fit's own context
 * (a pitch, a confirmed deck): the raise, the instrument, the cap. Their
 * claim, never scored and never verified here. The investor's own mandate
 * values are left out. Empty when fit is not set up or nothing is stated.
 */
export function pitchTermsOf(fit: Read<FitProfileDto | null>): readonly {
  readonly label: string;
  readonly value: string;
  readonly source: string;
}[] {
  if (fit.kind !== "READ" || fit.value === null) return [];
  return fit.value.parameters
    .filter(
      (parameter) =>
        parameter.parameter === "ROUND_TERMS" ||
        parameter.parameter === "CHEQUE_SIZE",
    )
    .flatMap((parameter) => parameter.context?.items ?? [])
    .filter((item) => item.source !== "YOUR_MANDATE")
    .filter(
      (item, index, all) =>
        all.findIndex((other) => other.label === item.label) === index,
    )
    .map((item) => ({
      label: item.label,
      value: item.value,
      source: FIT_CONTEXT_SOURCE_LABELS[item.source].toLowerCase(),
    }));
}

/** Fit with the investor's declared mandate: a band, or why there is none. */
export function fitState(
  fit: Read<FitProfileDto | null>,
): "UNAVAILABLE" | "NOT_SET_UP" | "PROFILE" {
  if (fit.kind === "UNAVAILABLE") return "UNAVAILABLE";
  return fit.value === null ? "NOT_SET_UP" : "PROFILE";
}

export type RecordGateqRow = {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly href: string;
  readonly action: string;
};

/**
 * The GateQ applications on this relationship, as the API authorised them
 * for this side (linked by relationship id, never by name). An investor
 * opens the exact application in their inbox; a founder opens their own
 * applications, where drafts are resumed and submissions read.
 */
export function recordGateq(
  dto: RelationshipGateqApplicationsDto,
  day: (iso: string) => string,
): readonly RecordGateqRow[] {
  // The reference is an opaque internal id: never shown as a title. Two
  // applications through the same gate are told apart by their order.
  const names = dto.items.map(
    (item) => item.gatewayName ?? "GateQ application",
  );
  return dto.items.map((item, at) => ({
    key: item.applicationId,
    title:
      names.filter((name) => name === names[at]).length > 1
        ? `${names[at] ?? ""} · ${String(names.slice(0, at + 1).filter((name) => name === names[at]).length)}`
        : (names[at] ?? "GateQ application"),
    status:
      item.status === "SUBMITTED"
        ? `Submitted${item.submittedAt === null ? "" : ` ${day(item.submittedAt)}`}`
        : item.status === "READY_TO_SUBMIT"
          ? `Ready to submit · started ${day(item.startedAt)}`
          : `In progress · started ${day(item.startedAt)}`,
    href:
      dto.side === "INVESTOR"
        ? `/gateq?${new URLSearchParams({ tab: "inbox", item: item.applicationId }).toString()}`
        : "/gateq?tab=applications",
    action:
      dto.side === "INVESTOR"
        ? "Open the dossier"
        : item.status === "SUBMITTED"
          ? "See it in your applications"
          : "Continue it in your applications",
  }));
}
