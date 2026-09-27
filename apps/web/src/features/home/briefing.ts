/**
 * Q's briefing when somebody opens Home (R35): a short line and a few
 * cards about what changed or waits on them, composed here from facts the
 * server read under their own session.
 *
 * Pure and deterministic: no model says what happened. Every card is a
 * fact from an authorised read and links to the real page for it. A read
 * that failed is absent, and absent says nothing -- it is never "none".
 * Nothing to say is no briefing at all, not a filler line.
 *
 * The fact types are deliberately narrow: the resolver copies only the
 * fields named here out of each response, so nothing else a response
 * carries can reach the briefing, and each role's facts come only from
 * reads that role is authorised for (briefing-facts.ts).
 */

/** An approval Q prepared that waits on this person. */
export type ApprovalFact = {
  readonly approvalId: string;
  readonly summary: string;
  /** Where it was asked; the card opens that conversation. */
  readonly conversationId: string | null;
};

/** One of their side's relationships, as the projection reads it. */
export type RelationshipFact = {
  readonly relationshipId: string;
  readonly counterpartName: string;
  readonly href: string;
  readonly state:
    "DISCOVERED" | "INTEREST_EXPRESSED" | "CONNECTED" | "DECLINED";
  readonly stateSince: string;
  /** For a company, the counterpart's id, so a slate company can be matched. */
  readonly counterpartId: string;
};

/** Founder only: an investor's interest in their company, unanswered. */
export type InterestFact = {
  readonly interestId: string;
  readonly investorName: string;
};

/** Founder only: a readiness requirement still outstanding. */
export type ReadinessGapFact = {
  readonly requirement: string;
  readonly description: string;
  readonly href: string;
};

/** Investor only: a company on their slate that has a pitch. */
export type PitchFact = {
  readonly companyId: string;
  readonly name: string;
};

/**
 * Their setup, part-way (founder directive 2026-09-27): given only on the
 * days the server's reminder policy says so, never composed from a guess.
 */
export type SetupNudgeFact = {
  readonly journeyType: "founder" | "investor";
  readonly doneCount: number;
  readonly requiredCount: number;
  readonly minutesLeft: number;
  /** The day it was given for; one card per day, recognisably. */
  readonly day: string;
};

export type FounderBriefingFacts = {
  readonly role: "FOUNDER";
  /** Changes since this instant are news. */
  readonly since: string;
  readonly approvals?: readonly ApprovalFact[] | undefined;
  readonly relationships?: readonly RelationshipFact[] | undefined;
  readonly interest?: readonly InterestFact[] | undefined;
  readonly readinessGaps?: readonly ReadinessGapFact[] | undefined;
  readonly setupNudge?: SetupNudgeFact | undefined;
};

export type InvestorBriefingFacts = {
  readonly role: "INVESTOR";
  readonly since: string;
  readonly approvals?: readonly ApprovalFact[] | undefined;
  readonly relationships?: readonly RelationshipFact[] | undefined;
  /** Companies ranked against their mandate that have a pitch. */
  readonly pitches?: readonly PitchFact[] | undefined;
  /** What the slate says about their mandate, when it says anything. */
  readonly mandate?: "ACTIVE" | "NOT_ACTIVE" | "NO_PREFERENCES" | undefined;
  readonly setupNudge?: SetupNudgeFact | undefined;
};

export type BriefingFacts = FounderBriefingFacts | InvestorBriefingFacts;

export type BriefingItem = {
  /** Stable per fact, so a card already briefed today can be recognised. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  /**
   * The setup reminder's card also offers "Later", which puts reminders
   * off for a few days (the server's policy says how many).
   */
  readonly later?: true | undefined;
};

export type Briefing = {
  /** One short line above the cards. */
  readonly line: string;
  /** What Q says when voice is on: the line and the first few titles. */
  readonly spoken: string;
  readonly items: readonly BriefingItem[];
};

/** A briefing, not a feed. */
export const MAX_BRIEFING_ITEMS = 5;
const MAX_RELATIONSHIP_ITEMS = 3;
const SPOKEN_ITEMS = 3;

function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0] ?? ""} and ${list[1] ?? ""}`;
  return `${list[0] ?? ""}, ${list[1] ?? ""} and ${String(list.length - 2)} more`;
}

function conversationHref(conversationId: string): string {
  return `/home?c=${encodeURIComponent(conversationId)}`;
}

function approvalItems(approvals: readonly ApprovalFact[] | undefined) {
  const open = (approvals ?? []).filter((a) => a.conversationId !== null);
  const first = open[0];
  if (first === undefined || first.conversationId === null) return [];
  return [
    {
      id: `approval:${first.approvalId}`,
      title:
        open.length === 1
          ? "Waiting for your approval"
          : `${String(open.length)} things wait for your approval`,
      description: first.summary,
      href: conversationHref(first.conversationId),
    },
  ];
}

function isNews(fact: RelationshipFact, since: string): boolean {
  const at = Date.parse(fact.stateSince);
  const from = Date.parse(since);
  return !Number.isNaN(at) && !Number.isNaN(from) && at >= from;
}

function relationshipItems(facts: BriefingFacts): BriefingItem[] {
  const recent = (facts.relationships ?? [])
    .filter((fact) => isNews(fact, facts.since))
    .sort((a, b) => Date.parse(b.stateSince) - Date.parse(a.stateSince));
  const items: BriefingItem[] = [];
  for (const fact of recent) {
    const id = `relationship:${fact.relationshipId}:${fact.state}`;
    if (fact.state === "CONNECTED") {
      items.push({
        id,
        title: `You're connected with ${fact.counterpartName}`,
        description: "A first meeting is the natural next step.",
        href: fact.href,
      });
    } else if (fact.state === "DECLINED" && facts.role === "INVESTOR") {
      // Only news to the investor: the founder made that decision.
      items.push({
        id,
        title: `${fact.counterpartName} didn't take it forward`,
        description: "Nothing is needed from you.",
        href: fact.href,
      });
    } else if (
      fact.state === "INTEREST_EXPRESSED" &&
      facts.role === "FOUNDER" &&
      facts.interest === undefined
    ) {
      // The interest inbox did not answer; the relationship says as much.
      items.push({
        id,
        title: `${fact.counterpartName} expressed interest`,
        description: "Accept to connect, or decline.",
        href: fact.href,
      });
    }
  }
  return items.slice(0, MAX_RELATIONSHIP_ITEMS);
}

function interestItems(interest: readonly InterestFact[] | undefined) {
  const waiting = interest ?? [];
  const first = waiting[0];
  if (first === undefined) return [];
  return [
    {
      id: `interest:${waiting.map((i) => i.interestId).join(",")}`,
      title:
        waiting.length === 1
          ? `${first.investorName} expressed interest`
          : `${String(waiting.length)} investors expressed interest`,
      description:
        waiting.length === 1
          ? "Accept to connect, or decline."
          : names(waiting.map((i) => i.investorName)),
      href: "/company/interest",
    },
  ];
}

function readinessItems(gaps: readonly ReadinessGapFact[] | undefined) {
  const outstanding = gaps ?? [];
  const first = outstanding[0];
  if (first === undefined) return [];
  return [
    {
      id: `readiness:${outstanding.map((g) => g.requirement).join(",")}`,
      title:
        outstanding.length === 1
          ? "One step before investors can find you"
          : `${String(outstanding.length)} steps before investors can find you`,
      description: first.description,
      href: first.href,
    },
  ];
}

function pitchItems(facts: InvestorBriefingFacts): BriefingItem[] {
  // "Not yet acted on" needs the relationships read: without it, nothing
  // is claimed about which pitches are new to them.
  if (facts.relationships === undefined) return [];
  const touched = new Set(facts.relationships.map((r) => r.counterpartId));
  const fresh = (facts.pitches ?? []).filter((p) => !touched.has(p.companyId));
  const first = fresh[0];
  if (first === undefined) return [];
  return [
    {
      id: `pitches:${fresh.map((p) => p.companyId).join(",")}`,
      title:
        fresh.length === 1
          ? `A pitch from ${first.name}`
          : `${String(fresh.length)} pitches that match your mandate`,
      description:
        fresh.length === 1
          ? "Matches your mandate. You haven't acted on it yet."
          : names(fresh.map((p) => p.name)),
      href: "/discover",
    },
  ];
}

function mandateItems(facts: InvestorBriefingFacts): BriefingItem[] {
  switch (facts.mandate) {
    case "NOT_ACTIVE":
      return [
        {
          id: "mandate:not-active",
          title: "Your mandate isn't active",
          description: "Companies are ranked against an active mandate.",
          href: "/profile",
        },
      ];
    case "NO_PREFERENCES":
      return [
        {
          id: "mandate:no-preferences",
          title: "Your mandate has no preferences yet",
          description: "Add stage, sector or geography to sharpen your feed.",
          href: "/profile",
        },
      ];
    case "ACTIVE":
    case undefined:
      return [];
  }
}

/**
 * One quiet card: how far along, how long the rest takes, and the way back
 * in. Never a list of what is missing, never urgent words.
 */
export function setupNudgeItems(
  nudge: SetupNudgeFact | undefined,
): BriefingItem[] {
  if (nudge === undefined || nudge.doneCount >= nudge.requiredCount) return [];
  const minutes =
    nudge.minutesLeft === 1
      ? "about a minute left"
      : `about ${String(nudge.minutesLeft)} minutes left`;
  return [
    {
      id: `setup-nudge:${nudge.day}`,
      title: `Setup: ${String(nudge.doneCount)} of ${String(nudge.requiredCount)} done — ${minutes}`,
      description:
        nudge.journeyType === "investor"
          ? "Finish your mandate when you're ready; your feed sharpens with it."
          : "Finish your company setup when you're ready; Q picks up where you left off.",
      href: `/onboarding/${nudge.journeyType}?from=home`,
      later: true,
    },
  ];
}

/**
 * The briefing, or null when there is nothing to say. What needs them
 * comes first, then what changed, then what is worth a look.
 */
export function composeBriefing(facts: BriefingFacts): Briefing | null {
  const needs: BriefingItem[] = [...approvalItems(facts.approvals)];
  const changed: BriefingItem[] = [];
  const worth: BriefingItem[] = [];
  if (facts.role === "FOUNDER") {
    needs.push(...interestItems(facts.interest));
    changed.push(...relationshipItems(facts));
    worth.push(
      ...setupNudgeItems(facts.setupNudge),
      ...readinessItems(facts.readinessGaps),
    );
  } else {
    changed.push(...relationshipItems(facts));
    worth.push(
      ...setupNudgeItems(facts.setupNudge),
      ...pitchItems(facts),
      ...mandateItems(facts),
    );
  }
  const items = [...needs, ...changed, ...worth].slice(0, MAX_BRIEFING_ITEMS);
  if (items.length === 0) return null;
  const line =
    needs.length > 0
      ? needs.length === 1
        ? "One thing needs you."
        : "A few things need you."
      : changed.length > 0
        ? "Here's what changed this week."
        : "Worth a look.";
  const spoken = [
    line,
    ...items.slice(0, SPOKEN_ITEMS).map((item) => `${item.title}.`),
  ].join(" ");
  return { line, spoken, items };
}
