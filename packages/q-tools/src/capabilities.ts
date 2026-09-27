import {
  Q_NAVIGATE_DESTINATIONS,
  type QNavigateDestination,
} from "@capital-q/contracts";

/**
 * The capability registry (R20, founder 2026-09-26): every action Capital
 * Q can take for a person, in one code-built list, so Q neither denies a
 * capability it has nor claims one it has not, and the turn reader never
 * files a request for one of them as something else.
 *
 * Each entry names who performs it and how it is guarded:
 *
 * - TOOL: a typed tool in this package (Zod in/out, its own `authorize`),
 *   offered to a model by the Tool Registry only when the run's purpose and
 *   plan allow it. Eligibility for a run is "the registry offered it".
 * - HAND: one of Q's own hands in the Home Q answer seam, acted on from the
 *   turn reader's typed result (TURN_READER tool union): navigation, a
 *   visibility change, a document. Eligibility is a rule over facts code
 *   composed for the run, never over words.
 *
 * `approval` is the class a person experiences: INSTANT (a read, a screen,
 * a private document of their own) or PREPARE_APPROVE (Prepare → Approve:
 * the exact change is shown and nothing happens until they approve;
 * `executes` names the Approval Engine action types it leads to, each of
 * which authorises again at approval and at execution).
 *
 * Nothing here is authority. Offering, authorising and executing stay with
 * the Tool Registry, the tools' authorize steps and the action registry.
 */

export const Q_CAPABILITY_GROUPS = [
  "NAVIGATION",
  "PROFILE",
  "VISIBILITY",
  "HANDLE",
  "DOCUMENT",
  "MEDIA",
  "RESEARCH",
  "RELATIONSHIP",
  "RECORDS",
  "ONBOARDING",
  "SETTINGS",
] as const;
export type QCapabilityGroup = (typeof Q_CAPABILITY_GROUPS)[number];

export type QCapabilityApproval = "INSTANT" | "PREPARE_APPROVE";

/** Where a capability can run: Home Q's answer seam or the onboarding loop. */
export type QCapabilitySurface = "HOME_Q" | "ONBOARDING";

export type QCapabilityHand =
  | { readonly kind: "NAVIGATE"; readonly destination: QNavigateDestination }
  | { readonly kind: "SET_VISIBILITY" }
  | {
      readonly kind: "PREPARE_DOCUMENT";
      readonly documentType: "PITCH_DECK" | "INVESTMENT_BRIEF" | "OWN_MANDATE";
    };

/** What code composed for this run; the hands' eligibility reads only this. */
export type QCapabilityRunFacts = {
  readonly surface: QCapabilitySurface;
  /** Provider names of the tools the Tool Registry offered this run. */
  readonly offeredTools: ReadonlySet<string>;
  /** A company is a subject of the run (own context or named). */
  readonly company: boolean;
  /** The actor's own investor organisation is bound in the plan. */
  readonly ownInvestorOrganisation: boolean;
  /** An artifact service is composed (documents can be rendered and filed). */
  readonly artifacts: boolean;
  /** An own-mandate document port is composed. */
  readonly ownMandate: boolean;
  /** A visibility proposer is composed. */
  readonly visibility: boolean;
};

/**
 * R33: what only the person can do, on a screen (an OAuth consent, a
 * password, a file picked from their device, a camera): Q offers the exact
 * screen that has the control and takes them there when they say so,
 * never a dead end and never a claim that it did it.
 */
export type QCapabilityOffer = {
  readonly destination: QNavigateDestination;
  /** Why this cannot be a tool. */
  readonly reason: string;
};

export type QCapability = {
  readonly id: string;
  readonly group: QCapabilityGroup;
  readonly surfaces: readonly QCapabilitySurface[];
  /** What it does, in a person's terms. Trusted text: it reaches prompts. */
  readonly does: string;
  readonly performedBy:
    | { readonly kind: "TOOL"; readonly providerName: string }
    | { readonly kind: "HAND"; readonly hand: QCapabilityHand }
    | { readonly kind: "OFFER"; readonly offer: QCapabilityOffer };
  readonly approval: QCapabilityApproval;
  /**
   * It changes something when called, at once (a client action, a Save or
   * Pass, declining a waiting change): the turn reader is told it is an
   * action, not a screen or a document. PREPARE_APPROVE entries act too.
   */
  readonly acts: boolean;
  /** Approval Engine action types this can lead to (PREPARE_APPROVE only). */
  readonly executes: readonly string[];
  /** The eligibility rule, stated. */
  readonly eligibility: string;
  readonly eligible: (facts: QCapabilityRunFacts) => boolean;
};

const OFFERED =
  "offered by the Tool Registry for this run (its purpose, the plan's scope kinds, a composed port); the tool authorises again on every call";

function tool(
  providerName: string,
  group: QCapabilityGroup,
  does: string,
  options: {
    readonly approval?: QCapabilityApproval;
    readonly executes?: readonly string[];
    readonly surfaces?: readonly QCapabilitySurface[];
    readonly acts?: boolean;
  } = {},
): QCapability {
  const approval = options.approval ?? "INSTANT";
  return {
    id: `tool.${providerName}`,
    group,
    surfaces: options.surfaces ?? ["HOME_Q"],
    does,
    performedBy: { kind: "TOOL", providerName },
    approval,
    acts: approval === "PREPARE_APPROVE" || options.acts === true,
    executes: options.executes ?? [],
    eligibility: OFFERED,
    eligible: (facts) => facts.offeredTools.has(providerName),
  };
}

const SCREEN_DOES: Readonly<Record<QNavigateDestination, string>> = {
  HOME: "Opens Q's own page (home).",
  PROFILE: "Opens their profile screen.",
  CAPITAL: "Opens the Capital screen (their raise).",
  DISCOVER: "Opens Discover (the feed).",
  COMPANY_VISIBILITY: "Opens their company's visibility settings.",
  RELATIONSHIPS:
    "Opens their Relationships page: every company-investor relationship of their side, where each stands.",
  SETTINGS:
    "Opens Settings: theme, Q motion, Q's voice and connected accounts (Gmail).",
  VERIFICATION:
    "Opens their company's verification: what is verified and asking for verification.",
  PITCH:
    "Opens Pitch & media: their pitch video (upload, replace, remove, who can play it) and transcript.",
  COMPANY_INTEREST:
    "Opens their company's incoming investor interest, to read and answer it.",
};

/** Screens that belong to a company's own people. */
const COMPANY_SCREENS: ReadonlySet<QNavigateDestination> = new Set([
  "COMPANY_VISIBILITY",
  "VERIFICATION",
  "PITCH",
  "COMPANY_INTEREST",
]);

const NAVIGATION: readonly QCapability[] = Q_NAVIGATE_DESTINATIONS.map(
  (destination): QCapability => ({
    id: `navigate.${destination}`,
    group: "NAVIGATION",
    surfaces: ["HOME_Q"],
    does: SCREEN_DOES[destination],
    performedBy: { kind: "HAND", hand: { kind: "NAVIGATE", destination } },
    approval: "INSTANT",
    acts: false,
    executes: [],
    eligibility: COMPANY_SCREENS.has(destination)
      ? "a company is a subject of the run"
      : "always, on Home Q",
    eligible: (facts) =>
      facts.surface === "HOME_Q" &&
      (!COMPANY_SCREENS.has(destination) || facts.company),
  }),
);

function offer(
  id: string,
  group: QCapabilityGroup,
  does: string,
  destination: QNavigateDestination,
  reason: string,
  companyOnly: boolean = COMPANY_SCREENS.has(destination),
): QCapability {
  return {
    id: `offer.${id}`,
    group,
    surfaces: ["HOME_Q"],
    does,
    performedBy: { kind: "OFFER", offer: { destination, reason } },
    approval: "INSTANT",
    acts: false,
    executes: [],
    eligibility: companyOnly
      ? "a company is a subject of the run (it is a company's own)"
      : "always, on Home Q",
    eligible: (facts) =>
      facts.surface === "HOME_Q" && (!companyOnly || facts.company),
  };
}

/**
 * R33: what a person does themselves on a screen. Each is offered with
 * the screen that has the control; none is a dead end.
 */
const OFFERS: readonly QCapability[] = [
  offer(
    "gmail_connect",
    "SETTINGS",
    "Connect or disconnect their Gmail",
    "SETTINGS",
    "Google's OAuth consent is given by the person in Google's own window; no tool may hold or grant it.",
  ),
  offer(
    "pitch_video_upload",
    "MEDIA",
    "Upload, replace or remove their pitch video and choose who can play it",
    "PITCH",
    "The video file comes from their own device through the browser's file picker and goes straight to the video CDN; removal is on the same screen.",
  ),
  offer(
    "document_upload",
    "DOCUMENT",
    "Upload a document of their own (a deck, financials) for Q to read",
    "HOME",
    "The file comes from their own device through the browser's file picker (the attach control next to Q's input).",
  ),
  offer(
    "verification_request",
    "RECORDS",
    "Ask for their company to be verified",
    "VERIFICATION",
    "A verification request attests to their authority over the company; the person submits it themselves on the verification screen.",
  ),
];

export const Q_CAPABILITIES: readonly QCapability[] = Object.freeze([
  ...NAVIGATION,
  ...OFFERS,
  {
    id: "hand.set_visibility",
    group: "VISIBILITY",
    surfaces: ["HOME_Q"],
    does: "Prepares a change to who can see their company (discoverable or not), for their approval.",
    performedBy: { kind: "HAND", hand: { kind: "SET_VISIBILITY" } },
    approval: "PREPARE_APPROVE",
    acts: true,
    executes: ["company.visibility.set"],
    eligibility: "a visibility proposer is composed and a company is a subject",
    eligible: (facts) =>
      facts.surface === "HOME_Q" && facts.visibility && facts.company,
  },
  {
    id: "document.PITCH_DECK",
    group: "DOCUMENT",
    surfaces: ["HOME_Q"],
    does: "Prepares a pitch deck for a company and files it as their private document, with PDF and PPTX downloads.",
    performedBy: {
      kind: "HAND",
      hand: { kind: "PREPARE_DOCUMENT", documentType: "PITCH_DECK" },
    },
    approval: "INSTANT",
    acts: false,
    executes: [],
    eligibility: "an artifact service is composed",
    eligible: (facts) => facts.surface === "HOME_Q" && facts.artifacts,
  },
  {
    id: "document.INVESTMENT_BRIEF",
    group: "DOCUMENT",
    surfaces: ["HOME_Q"],
    does: "Prepares an investment brief or one-pager on a company, their own included, and files it as their private document with a PDF download.",
    performedBy: {
      kind: "HAND",
      hand: { kind: "PREPARE_DOCUMENT", documentType: "INVESTMENT_BRIEF" },
    },
    approval: "INSTANT",
    acts: false,
    executes: [],
    eligibility: "an artifact service is composed",
    eligible: (facts) => facts.surface === "HOME_Q" && facts.artifacts,
  },
  {
    id: "document.OWN_MANDATE",
    group: "DOCUMENT",
    surfaces: ["HOME_Q"],
    does: "Prepares a document of an investor's own mandate from their record, with a PDF download.",
    performedBy: {
      kind: "HAND",
      hand: { kind: "PREPARE_DOCUMENT", documentType: "OWN_MANDATE" },
    },
    approval: "INSTANT",
    acts: false,
    executes: [],
    eligibility:
      "an artifact service and the own-mandate port are composed, and the actor's own investor organisation is bound",
    eligible: (facts) =>
      facts.surface === "HOME_Q" &&
      facts.artifacts &&
      facts.ownMandate &&
      facts.ownInvestorOrganisation,
  },
  tool(
    "propose_profile_change",
    "PROFILE",
    "Changes their own profile — their name and headline, their company's profile, or their investor organisation's profile — shown to them exactly and applied only when they approve.",
    {
      approval: "PREPARE_APPROVE",
      executes: [
        "person.profile.update",
        "company.profile.update",
        "investor.profile.update",
      ],
    },
  ),
  tool(
    "propose_handle_claim",
    "HANDLE",
    "Claims a Capital Q handle and makes the shareable Q Card (with its QR code) for their own company or investor organisation, applied when they approve.",
    { approval: "PREPARE_APPROVE", executes: ["handle.claim"] },
  ),
  // The person's own decision, relayed: it prepares nothing and executes
  // only what the Approval Engine already holds for their approval.
  tool(
    "approve_pending_proposal",
    "RECORDS",
    "Approves, when they say so, the one change Q prepared in this conversation that is waiting for their decision, exactly as the Approve button on its card does.",
    { acts: true },
  ),
  tool(
    "get_q_card",
    "HANDLE",
    "Reads their own Q Card: whether it is made and saved, its handle, and whether it is findable.",
  ),
  // R20/R33: the app's own actions in their browser, done at once.
  tool(
    "set_theme",
    "SETTINGS",
    "Switches the app's appearance to light, dark or system.",
    { acts: true },
  ),
  tool("reload_page", "NAVIGATION", "Reloads the page they are on.", {
    acts: true,
  }),
  tool(
    "open_website",
    "NAVIGATION",
    "Opens their own website (from their own record, or as they gave it) in a new tab.",
    { acts: true },
  ),
  tool(
    "set_q_motion",
    "SETTINGS",
    "Sets how much Q moves on this device: full, calm or off.",
    { acts: true },
  ),
  tool(
    "set_voice",
    "SETTINGS",
    "Switches the voice Q speaks in on this device (female or male).",
    { acts: true },
  ),
  tool("sign_out", "SETTINGS", "Signs them out of Capital Q in this browser.", {
    acts: true,
  }),
  tool(
    "decline_pending_proposal",
    "RECORDS",
    "Declines, when they say no, a change Q prepared in this conversation that is waiting for their decision, exactly as the Decline button on its card does.",
    { acts: true },
  ),
  tool(
    "list_pending_approvals",
    "RECORDS",
    "Lists every change waiting for their approval, across their conversations.",
  ),
  tool(
    "list_my_documents",
    "DOCUMENT",
    "Lists the documents Q prepared for them (decks, briefs, one-pagers), newest first, with versions.",
  ),
  tool(
    "save_company",
    "RELATIONSHIP",
    "Saves a company to their Saved list in Discover.",
    { acts: true },
  ),
  tool(
    "unsave_company",
    "RELATIONSHIP",
    "Removes a company from their Saved list.",
    { acts: true },
  ),
  tool(
    "open_page",
    "NAVIGATION",
    "Opens one company's page, or their relationship with a company or an investor, by id.",
    { acts: true },
  ),
  tool(
    "propose_raise_change",
    "RECORDS",
    "Creates, changes, closes or replaces their company's raise, applied when they approve.",
    { approval: "PREPARE_APPROVE", executes: ["capital.objective.change"] },
  ),
  tool(
    "propose_mandate_change",
    "RECORDS",
    "Creates, changes, activates or closes their investor mandate, applied when they approve.",
    { approval: "PREPARE_APPROVE", executes: ["investor.mandate.change"] },
  ),
  tool(
    "propose_team_change",
    "PROFILE",
    "Changes their founder profile, their company's team facts, or their own role and title, applied when they approve.",
    {
      approval: "PREPARE_APPROVE",
      executes: ["company.team.change", "investor.representative.update"],
    },
  ),
  tool(
    "propose_q_card_change",
    "HANDLE",
    "Changes their Q Card's details (findable by search engines, which fields it shows), applied when they approve.",
    { approval: "PREPARE_APPROVE", executes: ["q_card.update"] },
  ),
  tool(
    "propose_investor_visibility",
    "VISIBILITY",
    "Changes who can see their investor organisation, applied when they approve.",
    { approval: "PREPARE_APPROVE", executes: ["investor.visibility.set"] },
  ),
  tool(
    "read_my_record",
    "RECORDS",
    "Reads their own records as their screens show them: verification, readiness, network and audience previews, team, raise history, Q's public findings, their investor organisation, role and mandates.",
  ),
  tool(
    "reassess_marketplace_readiness",
    "RECORDS",
    "Checks their company's marketplace readiness again.",
    { acts: true },
  ),
  tool(
    "list_uploaded_documents",
    "DOCUMENT",
    "Lists the documents their company uploaded and whether Q has read them.",
  ),
  tool(
    "read_relationship_email",
    "RELATIONSHIP",
    "Reads the email exchanged on one of their relationships, from their connected Gmail.",
  ),
  tool(
    "pass_company",
    "RELATIONSHIP",
    "Passes on a company in their Discover feed.",
    { acts: true },
  ),
  tool(
    "propose_share_raise",
    "VISIBILITY",
    "Shares their raise with a named investor, applied when they approve.",
    { approval: "PREPARE_APPROVE", executes: ["disclosure.raise.share"] },
  ),
  tool(
    "propose_revoke_share",
    "VISIBILITY",
    "Stops sharing their raise with an investor, applied when they approve.",
    { approval: "PREPARE_APPROVE", executes: ["disclosure.share.revoke"] },
  ),
  tool(
    "get_disclosure_state",
    "VISIBILITY",
    "Reads who their raise is shared with and what each can see.",
  ),
  tool(
    "propose_express_interest",
    "RELATIONSHIP",
    "Expresses their interest in a company, sent when they approve.",
    {
      approval: "PREPARE_APPROVE",
      executes: ["relationship.interest.express"],
    },
  ),
  tool(
    "propose_interest_answer",
    "RELATIONSHIP",
    "Answers an investor's interest in their company (accept or decline), sent when they approve.",
    {
      approval: "PREPARE_APPROVE",
      executes: ["relationship.interest.respond"],
    },
  ),
  tool(
    "propose_email",
    "RELATIONSHIP",
    "Drafts an email to the other side of a relationship (a company's founders or an investor's people), sent from their own connected Gmail when they approve; they can edit it first.",
    { approval: "PREPARE_APPROVE", executes: ["email.send"] },
  ),
  tool(
    "get_relationship",
    "RELATIONSHIP",
    "Reads where they stand with a company or investor.",
  ),
  // --- R34 relationship chat (CHAT worker block; keep together) ---------
  tool(
    "list_messages",
    "RELATIONSHIP",
    "Reads their chat with the other side of a relationship: the latest messages, who wrote them, and files shared by name.",
  ),
  tool(
    "propose_chat_message",
    "RELATIONSHIP",
    "Drafts a chat message to the other side of a connected relationship, optionally sharing one of their own documents; it is posted as them when they approve.",
    { approval: "PREPARE_APPROVE", executes: ["chat.message.send"] },
  ),
  tool(
    "propose_reminder",
    "RELATIONSHIP",
    "Prepares a reminder about a relationship for them to approve; it becomes a calendar reminder once Calendar is connected.",
    { approval: "PREPARE_APPROVE", executes: ["reminder.create"] },
  ),
  tool(
    "propose_meeting",
    "RELATIONSHIP",
    "Prepares a meeting proposal (purpose, times, length) with the other side of a connected relationship for them to approve; it becomes a calendar invite with a Meet link once Calendar is connected.",
    { approval: "PREPARE_APPROVE", executes: ["meeting.propose"] },
  ),
  // --- end R34 ------------------------------------------------------------
  tool(
    "list_incoming_interest",
    "RELATIONSHIP",
    "Lists the investors who have expressed interest in their company.",
  ),
  tool(
    "get_pitch_moment",
    "MEDIA",
    "Reads the part of a pitch video they are watching.",
  ),
  tool("get_company", "RECORDS", "Reads a company's profile on Capital Q."),
  tool(
    "get_capital_objective",
    "RECORDS",
    "Reads a company's raise (capital objective).",
  ),
  tool(
    "get_investor_mandate",
    "RECORDS",
    "Reads an investor's mandate on Capital Q.",
  ),
  tool("search_companies", "RECORDS", "Searches companies on Capital Q."),
  tool(
    "discovery_slate",
    "RECORDS",
    "Reads the companies in their Discover feed.",
  ),
  tool(
    "find_prospective_investors",
    "RECORDS",
    "Finds investors on Capital Q who may fit their company.",
  ),
  tool(
    "recommendation_explanation",
    "RECORDS",
    "Explains why a company was recommended to them.",
  ),
  tool(
    "research_public_web",
    "RESEARCH",
    "Researches public web sources, cited.",
  ),
  tool(
    "extract_public_web",
    "RESEARCH",
    "Reads one public web page they name.",
  ),
  tool(
    "lookup_public_profile",
    "RESEARCH",
    "Looks up a public professional profile.",
  ),
  // The onboarding loop's own hands: reversible writes to the person's own
  // onboarding under scoped delegation (ADR 0016), not Approval Engine work.
  tool("get_onboarding_state", "ONBOARDING", "Reads their onboarding.", {
    surfaces: ["ONBOARDING"],
  }),
  ...(
    [
      ["record_answers", "Records answers they gave."],
      ["recommend", "Recommends an answer for them to accept."],
      ["accept_recommendation", "Records a recommendation they accepted."],
      ["correct_answer", "Corrects an answer they changed."],
      ["set_aside", "Sets a question aside they declined."],
      ["confirm_as_stated", "Keeps an answer as they stated it."],
      ["confirm_and_finish", "Completes their onboarding when they say so."],
      ["note_preference", "Keeps a preference they stated, quote-checked."],
    ] as const
  ).map(([name, does]) =>
    tool(name, "ONBOARDING", does, { surfaces: ["ONBOARDING"] }),
  ),
]);

/**
 * What is not a capability of Q's, with the reason. The completeness
 * tests require every tool, action type and navigation screen to be in
 * the registry or here.
 */
export const Q_CAPABILITY_EXCLUSIONS: Readonly<{
  readonly tools: Readonly<Record<string, string>>;
  readonly actionTypes: Readonly<Record<string, string>>;
}> = Object.freeze({
  tools: {},
  actionTypes: {},
});

/**
 * The groups of what Q does on Home, from the registry: the onboarding
 * loop names them, so a request for one mid-onboarding is neither denied
 * nor claimed done.
 */
export const HOME_Q_CAPABILITY_GROUPS: readonly QCapabilityGroup[] =
  Object.freeze(
    Q_CAPABILITY_GROUPS.filter((group) =>
      Q_CAPABILITIES.some(
        (capability) =>
          capability.group === group && capability.surfaces.includes("HOME_Q"),
      ),
    ),
  );

const cache = new Map<string, readonly QCapability[]>();
const CACHE_LIMIT = 256;

function factsKey(facts: QCapabilityRunFacts): string {
  return [
    facts.surface,
    facts.company ? 1 : 0,
    facts.ownInvestorOrganisation ? 1 : 0,
    facts.artifacts ? 1 : 0,
    facts.ownMandate ? 1 : 0,
    facts.visibility ? 1 : 0,
    [...facts.offeredTools].sort().join(","),
  ].join("|");
}

/**
 * The capabilities eligible for one run, in registry order. Pure code over
 * composed facts; the result is cached by those facts, so every turn of an
 * actor with the same composition reuses one frozen list.
 */
export function eligibleCapabilities(
  facts: QCapabilityRunFacts,
): readonly QCapability[] {
  const key = factsKey(facts);
  const known = cache.get(key);
  if (known !== undefined) {
    return known;
  }
  const eligible = Object.freeze(
    Q_CAPABILITIES.filter(
      (capability) =>
        capability.surfaces.includes(facts.surface) &&
        capability.eligible(facts),
    ),
  );
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, eligible);
  return eligible;
}
