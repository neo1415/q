import type { QAskSurface, QScreenRoute } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * Q intelligence step 1 (A3): the situation every Q model step is told --
 * today's date and the time where the person is, who is asking, the
 * surface and the page. Built by code on the server from the person's own
 * records and the firewall-filtered screen; nothing in it is read from a
 * model, and nothing in it is about anyone but the person asking.
 */

/**
 * Who is asking, as the server resolved it from their own membership
 * (never from the client): their name, which side of the platform their
 * organisation is on, and its name. Any part may be unknown.
 */
export type QSituationAsker = {
  readonly displayName: string | null;
  readonly role: "FOUNDER" | "INVESTOR" | null;
  readonly organisation: string | null;
  /** Their saved IANA zone (profile); null when they never saved one. */
  readonly timeZone: string | null;
  /**
   * Owner live test 7 Nov (R3): their own organisation as their own
   * record holds it -- where it is based and its site -- read as them.
   * Absent: not read; each part null when not declared.
   */
  readonly own?: QSituationOwnOrganisation | null | undefined;
  /**
   * Owner live test 7 Nov (R2): the record on their screen now, by name
   * -- one the firewall already resolved for them (the run's screen),
   * never one the client named unchecked. Absent: nothing on screen.
   */
  readonly onScreen?: QSituationOnScreen | null | undefined;
};

export type QSituationOwnOrganisation = {
  readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
  readonly city: string | null;
  /** ISO 3166-1 alpha-2, as the record stores it. */
  readonly country: string | null;
  readonly website: string | null;
};

export type QSituationOnScreen = {
  readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
  readonly name: string;
};

/**
 * The record on screen, by id, as the firewall passed it on: what a
 * situation port may name for them.
 */
export type QSituationScreenIds = {
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
};

export type QSituationSurface = QAskSurface | "VOICE";

/**
 * One bounded line. 7 Nov: it grew from 600 to carry who they are, what is
 * theirs, what is on their screen and how pointing words and Q's voice
 * work -- the one source every reader and answer is told (R2, R3, R6).
 */
export const SITUATION_HEADER_MAX_CHARS = 1_500;

const UTC_LIKE = /^(Etc\/)?(UTC|UCT|GMT|Universal|Zulu|Greenwich)$/i;

function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Their zone: the one saved on their profile, else the device's when the
 * runtime knows it (a device on UTC usually means an unset clock, not a
 * person in London); null when neither.
 */
export function personTimeZone(
  profileZone: string | null | undefined,
  deviceZone: string | null | undefined,
): string | null {
  if (typeof profileZone === "string" && knownZone(profileZone)) {
    return profileZone;
  }
  return typeof deviceZone === "string" &&
    knownZone(deviceZone) &&
    !UTC_LIKE.test(deviceZone)
    ? deviceZone
    : null;
}

const PAGE_NAMES: Readonly<Record<QScreenRoute, string>> = {
  HOME: "Home",
  DISCOVER: "Discover",
  CAPITAL: "Capital",
  PROFILE: "their profile",
  COMPANY_VISIBILITY: "company visibility",
  COMPANY_INTEREST: "investor interest in their company",
  COMPANY: "a company profile",
  PITCH: "their pitch",
  RELATIONSHIPS: "Relationships",
  RELATIONSHIP_COMPANY: "a relationship with a company",
  RELATIONSHIP_INVESTOR: "a relationship with an investor",
  VERIFICATION: "Verification",
  ONBOARDING: "setup (onboarding)",
  DAILY: "the Q Daily",
  DOCUMENTS: "their documents",
  WORK: "Q's work",
  OTHER: "another Capital Q page",
};

const SURFACE_NAMES: Readonly<Record<QSituationSurface, string>> = {
  CHAT: "Q chat (typed)",
  DOCK: "the Q dock beside the page (typed)",
  STAGE: "the Q page (typed)",
  VOICE: "voice (spoken aloud)",
};

/** Their own words for a name: one line, no quotes, bounded. */
function plain(text: string | null, max: number): string | null {
  if (text === null) return null;
  const cleaned = text
    .replace(/\p{Cc}|["`]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return cleaned.length === 0 ? null : cleaned;
}

function dateIn(now: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}

function isoDateIn(now: Date, zone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function timeIn(now: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/**
 * The header. Deterministic for the same inputs; bounded so that it always
 * fits in front of everything else.
 */
export function situationHeader(input: {
  readonly now: Date;
  readonly asker: QSituationAsker | null;
  /** The device's zone from the (firewall-filtered) screen, if sent. */
  readonly deviceTimeZone?: string | null | undefined;
  readonly surface: QSituationSurface | null;
  readonly page: QScreenRoute | null;
}): string {
  const zone = personTimeZone(
    input.asker?.timeZone ?? null,
    input.deviceTimeZone ?? null,
  );
  const at = zone ?? "UTC";
  // The next calendar day where they are, not now + 24 h (a day with a
  // clock change is 23 or 25 hours long).
  const [year, month, day] = isoDateIn(input.now, at).split("-").map(Number);
  const tomorrow = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1, 12),
  );
  const when =
    zone === null
      ? `Today is ${dateIn(input.now, at)} (${isoDateIn(input.now, at)}) in UTC; the time is ${timeIn(input.now, at)} UTC. Their time zone is unknown, so their own date may differ near midnight.`
      : `Today for them is ${dateIn(input.now, at)} (${isoDateIn(input.now, at)}); their time is ${timeIn(input.now, at)} (${zone}).`;
  const name = plain(input.asker?.displayName ?? null, 80);
  const organisation = plain(input.asker?.organisation ?? null, 120);
  const role = input.asker?.role ?? null;
  const who = [
    name ?? "name unknown",
    role === null ? "role unknown" : role,
    ...(organisation === null
      ? []
      : [`${role === "INVESTOR" ? "at" : "of"} ${organisation}`]),
  ].join(", ");
  const header = [
    "SITUATION (Capital Q, by code, this turn):",
    when,
    `Tomorrow is ${dateIn(tomorrow, "UTC")}.`,
    `Asking: ${who}.`,
    ...ownLine(organisation, input.asker?.own ?? null),
    ...screenLine(input.asker?.onScreen ?? null),
    referenceLine(name),
    VOICE_LINE,
    `Surface: ${input.surface === null ? "unknown" : SURFACE_NAMES[input.surface]}.`,
    `Page: ${input.page === null ? "unknown" : PAGE_NAMES[input.page]}.`,
    "Use this date for today, tomorrow, ages and deadlines; never another.",
  ].join(" ");
  return header.slice(0, SITUATION_HEADER_MAX_CHARS);
}

/**
 * R2: how pointing words resolve, said once for every reader and answer.
 * First person is always the person (owner live 7 Nov: "i meant me" was
 * taken as the company on screen); a pointing word follows the
 * conversation, then the screen, and is never the person.
 */
function referenceLine(name: string | null): string {
  const self = name === null ? "themselves" : `themselves (${name})`;
  return [
    `When they say me, my, I or myself they mean ${self}, never a company or the record on their screen.`,
    "When they point with their, it, this or that (they, them, that one) they mean what the conversation is about; only when the conversation names nothing, what is on their screen; never themselves.",
  ].join(" ");
}

/**
 * R6: Q speaks to them, never about them (owner live 7 Nov: replies said
 * "the user", "the person's screen", "the previous screen action").
 * Notes and records Q is given are written about them; that is not how Q
 * talks.
 */
const VOICE_LINE =
  "Speak to them as you and of yourself as I; never call them the user or the person, and never narrate screen actions or records (the page was opened on screen): say what you did, I have opened it.";

const KIND_WORDS: Readonly<Record<QSituationOwnOrganisation["kind"], string>> =
  {
    COMPANY: "a company",
    INVESTOR_ORGANISATION: "an investor organisation",
  };

function countryName(code: string | null): string | null {
  if (code === null || !/^[A-Z]{2}$/u.test(code)) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** R3: their own organisation, as theirs, with where it is and its site. */
function ownLine(
  organisation: string | null,
  own: QSituationOwnOrganisation | null,
): readonly string[] {
  if (organisation === null || own === null) return [];
  const where = [plain(own.city, 80), countryName(own.country)].filter(
    (part): part is string => part !== null,
  );
  const website = plain(own.website, 200);
  const details = [
    KIND_WORDS[own.kind],
    ...(where.length === 0 ? [] : [`based in ${where.join(", ")}`]),
    ...(website === null ? [] : [`website ${website}`]),
  ].join("; ");
  const theirs =
    own.kind === "COMPANY" ? "my company, my startup" : "my firm, my fund";
  return [
    `Their own organisation: ${organisation} (${details}).`,
    `When they say ${theirs}, we, us or our they mean ${organisation}: read it as their own record, never search for it as someone else's.`,
  ];
}

/** R2: the record on their screen now, by name. */
function screenLine(onScreen: QSituationOnScreen | null): readonly string[] {
  const name = plain(onScreen?.name ?? null, 120);
  if (onScreen === null || name === null) return [];
  return [`On their screen now: ${name} (${KIND_WORDS[onScreen.kind]}).`];
}

/**
 * The surface: a spoken turn is VOICE whatever the screen says; a typed one
 * is the screen's own kind, else plain chat.
 */
export function situationSurfaceOf(
  spoken: boolean,
  surface: QAskSurface | undefined,
): QSituationSurface {
  return spoken ? "VOICE" : (surface ?? "CHAT");
}

/**
 * Who is asking, read for the person by the server (q-api: their profile
 * and the membership their actor context carries). Null: nothing known.
 */
export type QSituationPort = (
  actor: ActorContext,
  /** The firewall-filtered screen's record, when the caller has one. */
  screen?: QSituationScreenIds | null,
) => Promise<QSituationAsker | null>;
