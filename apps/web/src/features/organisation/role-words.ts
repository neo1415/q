import type {
  ActivityItemDto,
  ActivityKind,
  ActivityQuery,
  MeCapabilitiesDto,
  TeamKind,
  TeamRole,
} from "@capital-q/contracts";

/**
 * Organisation roles in plain words (owner, admin, member), the reasons a
 * control is held back, and the activity feed's words. Pure: the screens,
 * the review page and the tests all read the same table.
 *
 * The capability names are the server's (MeCapabilitiesDto.capabilities);
 * nothing here decides what anyone may do. A control that is held back
 * here is still refused by the API if pressed some other way.
 */

export const ROLE_WORD: Readonly<Record<TeamRole, string>> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

/** Capability names the web gates on (from the DTO, never role strings). */
export const CAP = {
  ACTIVITY_VIEW: "organisation.activity.view",
  ORGANISATION_ADMIN: "organisation.admin",
  ORGANISATION_OWN: "organisation.own",
  COMPANY_EDIT: "company.edit",
  INVESTOR_EDIT: "investor.edit",
  MANDATE_EDIT: "investor.mandate.edit",
  GATE_PUBLISH: "investor.gateway.publish",
  DISCLOSURE_MANAGE: "disclosure.manage",
  RAISE_EDIT: "capital_objective.edit",
  DOCUMENT_CREATE: "document.create",
  Q_APPROVE: "q.action.approve",
} as const;

/** Why a control is held back, in one short sentence. */
const REASONS: Readonly<Record<string, string>> = {
  [CAP.ACTIVITY_VIEW]: "Only admins and owners see the team's activity.",
  [CAP.ORGANISATION_ADMIN]: "Only admins can do this.",
  [CAP.ORGANISATION_OWN]: "Only owners can do this.",
  [CAP.COMPANY_EDIT]: "Only admins can edit the company profile.",
  [CAP.INVESTOR_EDIT]: "Only admins can edit the firm's profile.",
  [CAP.MANDATE_EDIT]: "Only admins can change the mandate.",
  [CAP.GATE_PUBLISH]: "Only admins can publish the gate's rules.",
  [CAP.DISCLOSURE_MANAGE]: "Only admins decide who sees each document.",
  [CAP.RAISE_EDIT]: "Only admins can change the raise.",
};

export function gateReason(capability: string): string {
  return REASONS[capability] ?? "Only admins can do this.";
}

export type Gate = { readonly allowed: boolean; readonly reason: string | null };

/**
 * Whether a control shows as usable. Unknown capabilities (the read failed,
 * or a page has no provider) leave the control as it is: the server
 * decides on the press, and an honest refusal follows. Hiding is never the
 * guard, so it is never guessed in the safe-looking direction either.
 */
export function gateOf(
  capabilities: MeCapabilitiesDto | null | undefined,
  capability: string | undefined,
): Gate {
  if (capability === undefined || capabilities == null) {
    return { allowed: true, reason: null };
  }
  return capabilities.capabilities.includes(capability)
    ? { allowed: true, reason: null }
    : { allowed: false, reason: gateReason(capability) };
}

type Line = {
  readonly capability: string;
  readonly side: TeamKind | "BOTH";
  readonly can: string;
};

/** What a role means here, line by line, keyed on capabilities held. */
const LINES: readonly Line[] = [
  { capability: CAP.Q_APPROVE, side: "BOTH", can: "Approve what Q sends for you" },
  { capability: CAP.DOCUMENT_CREATE, side: "BOTH", can: "Upload documents" },
  { capability: CAP.COMPANY_EDIT, side: "COMPANY", can: "Edit the company profile" },
  {
    capability: CAP.DISCLOSURE_MANAGE,
    side: "COMPANY",
    can: "Decide who sees each data room document",
  },
  { capability: CAP.RAISE_EDIT, side: "COMPANY", can: "Change the raise" },
  { capability: CAP.INVESTOR_EDIT, side: "FIRM", can: "Edit the firm's profile" },
  { capability: CAP.MANDATE_EDIT, side: "FIRM", can: "Change the mandate" },
  { capability: CAP.GATE_PUBLISH, side: "FIRM", can: "Publish the gate's rules" },
  {
    capability: CAP.ORGANISATION_ADMIN,
    side: "BOTH",
    can: "Invite people and change their roles",
  },
  {
    capability: CAP.ORGANISATION_ADMIN,
    side: "BOTH",
    can: "Choose the plan and manage billing",
  },
  {
    capability: CAP.ACTIVITY_VIEW,
    side: "BOTH",
    can: "See what everyone on the team has done",
  },
  {
    capability: CAP.ORGANISATION_OWN,
    side: "BOTH",
    can: "Hand over ownership",
  },
];

export const ROLE_SUMMARY: Readonly<Record<TeamRole, string>> = {
  OWNER:
    "You have every admin power, and you are answerable for the account: ownership and closing it are yours.",
  ADMIN:
    "You run the team: people, roles, the profile and what is shared. Owners also hand over ownership.",
  MEMBER:
    "You work on everything day to day. Some changes are kept for admins, so they stay deliberate.",
};

/** The lines a person can and cannot do, from what they hold. */
export function roleLines(
  capabilities: readonly string[],
  kind: TeamKind,
): { readonly can: readonly string[]; readonly cannot: readonly string[] } {
  const held = new Set(capabilities);
  const mine = LINES.filter((line) => line.side === "BOTH" || line.side === kind);
  return {
    can: mine.filter((line) => held.has(line.capability)).map((line) => line.can),
    cannot: mine
      .filter((line) => !held.has(line.capability))
      .map((line) => line.can),
  };
}

// ---------------------------------------------------------------------------
// The activity feed's words.
// ---------------------------------------------------------------------------

export const KIND_WORD: Readonly<Record<ActivityKind, string>> = {
  TEAM: "Team",
  ORGANISATION: "Company or firm details",
  PROFILE: "Profiles",
  RELATIONSHIPS: "Relationships",
  MESSAGES: "Messages",
  MEETINGS: "Meetings",
  DOCUMENTS: "Documents",
  SHARING: "Sharing",
  CAPITAL: "Raise",
  MANDATE: "Mandate",
  MEDIA: "Videos",
  VERIFICATION: "Verification",
  OTHER: "Other",
};

export const OUTCOME_WORD: Readonly<
  Record<Exclude<ActivityItemDto["outcome"], "SUCCEEDED">, string>
> = {
  FAILED: "Didn't go through",
  DENIED: "Not allowed",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "12 Oct 2026": English, so t() localises it like every other date. */
export function dayWords(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ""} ${String(at.getFullYear())}`;
}

/** "Just now", "5 minutes ago", "3 hours ago", "Yesterday", or the day. */
export function whenWords(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const ms = now.getTime() - at.getTime();
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) {
    return minutes === 1 ? "1 minute ago" : `${String(minutes)} minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${String(hours)} hours ago`;
  if (hours < 48) return "Yesterday";
  return dayWords(iso);
}

/** Local day bounds for a date input (yyyy-mm-dd), as offset datetimes. */
export function dayBound(day: string, end: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const at = new Date(`${day}T${end ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

// ---------------------------------------------------------------------------
// The feed's query: filters in, the API's query out (cursor, never offset).
// ---------------------------------------------------------------------------

export type ActivityFilters = {
  readonly member?: string | undefined;
  readonly kind?: ActivityKind | undefined;
  /** yyyy-mm-dd, the person's own day. */
  readonly fromDay?: string | undefined;
  readonly toDay?: string | undefined;
};

export const ACTIVITY_PAGE_SIZE = 30;

export function activityQuery(
  filters: ActivityFilters,
  cursor?: string,
): ActivityQuery {
  const from =
    filters.fromDay === undefined ? undefined : dayBound(filters.fromDay, false);
  const to =
    filters.toDay === undefined ? undefined : dayBound(filters.toDay, true);
  return {
    limit: ACTIVITY_PAGE_SIZE,
    ...(filters.member === undefined ? {} : { member: filters.member }),
    ...(filters.kind === undefined ? {} : { kind: filters.kind }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

