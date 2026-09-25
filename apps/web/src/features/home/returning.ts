import type { OwnContext } from "@/features/q/context";

/**
 * The returning person (CQ-WEB-030): who is arriving, what Q says to them,
 * and which few things it offers. Pure, so every rule here is a test.
 *
 * Nothing in this file reads anything. The facts arrive already resolved
 * on the server under the person's own session; this only decides what to
 * say about them, and never says more than they support: a read that
 * failed is UNKNOWN, and UNKNOWN produces no claim either way.
 */

export type Known = "YES" | "NO" | "UNKNOWN";

/** The founder's deck, from whichever place Capital Q holds one. */
export type DeckFact =
  /** A deck Q prepared, ready to open. */
  | { readonly kind: "PREPARED"; readonly artifactId: string }
  /** A deck the founder uploaded; Q has read it. */
  | { readonly kind: "UPLOADED" }
  | { readonly kind: "NONE" }
  | { readonly kind: "UNKNOWN" };

export type ReturningFacts = {
  readonly context: OwnContext;
  /** A setup journey they started and have not finished. */
  readonly unfinished: "founder" | "investor" | null;
  /** The name Capital Q holds for them, if any. */
  readonly name: string | null;
  /** Whether their Discover slate has anything in it right now. */
  readonly feed: Known;
  /** Founder only: whether a pitch video is on record. */
  readonly pitch: Known;
  /** Founder only. */
  readonly deck: DeckFact;
  /**
   * Where the unfinished setup stands, read from the session and the
   * interview thread the server kept. Absent when there is no unfinished
   * setup or the read did not answer; nothing is then said about it
   * beyond "part-way through".
   */
  readonly setup?: SetupFacts | undefined;
};

/** An unfinished setup, as its own state tells it. */
export type SetupFacts = {
  /** The parts of the journey that are settled, in the journey's words. */
  readonly covered: readonly string[];
  /**
   * The question Q asked last and is still waiting on, verbatim -- Q's own
   * sentence from the interview, never one composed here. Null when the
   * person has moved on since, or Q had not asked anything yet.
   */
  readonly pending: string | null;
};

/**
 * First time or back. Anyone Capital Q has a company or an investor
 * organisation for is back, and so is anyone with a setup left part-way;
 * a person with neither is new. When Capital Q could not be asked, it is
 * not known which, and nothing is said as if it were.
 */
export type Arrival = "FIRST_TIME" | "RETURNING" | "UNKNOWN";

export function arrivalFor(
  context: OwnContext,
  unfinished: ReturningFacts["unfinished"],
): Arrival {
  if (context.kind !== "NONE" || unfinished !== null) {
    return "RETURNING";
  }
  return context.unavailable === true ? "UNKNOWN" : "FIRST_TIME";
}

/**
 * The first name, for a greeting. A display name is whatever the person
 * typed; the first word of it is what somebody would call them.
 */
export function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first === undefined || first.length === 0 ? null : first;
}

export type ReturningGreeting = {
  /** "Welcome back, Ada." */
  readonly headline: string;
  /** Q's question: what they would like to do, in terms of where they are. */
  readonly question: string;
  /**
   * Where an unfinished setup left off: Q's own last question, shown as
   * itself. Null when there is none to show.
   */
  readonly leftOff: string | null;
  /**
   * The greeting as Q says it when the person turns voice on over it:
   * the same words, once. Voice then continues this welcome rather than
   * opening with a second one.
   */
  readonly spoken: string;
};

export function returningGreeting(facts: ReturningFacts): ReturningGreeting {
  const name = firstName(facts.name);
  const headline = name === null ? "Welcome back." : `Welcome back, ${name}.`;
  const question = questionFor(facts);
  const leftOff =
    facts.unfinished === null ? null : (facts.setup?.pending ?? null);
  return { headline, question, leftOff, spoken: `${headline} ${question}` };
}

/** "mandate", "mandate and stage", "mandate, cheque and stage". */
function joinParts(parts: readonly string[]): string {
  const lower = parts.map((part) => part.toLowerCase());
  if (lower.length <= 1) return lower[0] ?? "";
  return `${lower.slice(0, -1).join(", ")} and ${lower.at(-1) ?? ""}`;
}

/**
 * Q's question, picked from the one thing most worth saying. Bounded copy
 * rather than a model call: it renders instantly, and a claim here is
 * only ever one the facts make.
 */
function questionFor(facts: ReturningFacts): string {
  const { unfinished } = facts;
  if (unfinished !== null) {
    // Where they left off, in the journey's own terms: what is settled,
    // then the offer. The question Q was on is shown beside this as Q's
    // own sentence (`leftOff`), not paraphrased into it.
    const covered = facts.setup?.covered ?? [];
    const done =
      covered.length === 0 ? "" : `We've covered ${joinParts(covered)}. `;
    return unfinished === "investor"
      ? `${done}Your mandate is part-way through — shall we pick it up where we left off, or would you rather look around first?`
      : `${done}Your company setup is part-way through — shall we pick it up where we left off?`;
  }
  const role = roleOf(facts);
  if (role === "INVESTOR" && facts.feed === "YES") {
    return "There are companies in your feed, ranked against your mandate. Where would you like to start?";
  }
  if (role === "INVESTOR" && facts.feed === "NO") {
    return "Your mandate is set, and nothing on Capital Q matches it yet. Shall we look at what's close, or go over the mandate together?";
  }
  if (role === "FOUNDER" && facts.pitch === "NO") {
    return "Investors watch a pitch before they read anything else. Would you like to record yours, or work on something else?";
  }
  return role === "FOUNDER"
    ? "What would you like to work on today?"
    : "What would you like to do today?";
}

/**
 * Which side of the table they are on: the context Capital Q resolved, or,
 * before one exists, the journey they started.
 */
function roleOf(facts: ReturningFacts): "FOUNDER" | "INVESTOR" | null {
  if (facts.context.kind !== "NONE") {
    return facts.context.kind;
  }
  if (facts.unfinished === "founder") return "FOUNDER";
  if (facts.unfinished === "investor") return "INVESTOR";
  return null;
}

/**
 * A card goes somewhere real, asks Q something real through the ordinary
 * Q path, or opens a document Q already made beside the conversation.
 * Nothing here pretends to act.
 */
export type ReturningCardAction =
  | { readonly kind: "NAVIGATE"; readonly href: string }
  | { readonly kind: "ASK_Q"; readonly prompt: string }
  /** Opened in the Q surface's own viewer: Q work stays with Q (K). */
  | { readonly kind: "OPEN_ARTIFACT"; readonly artifactId: string };

export type ReturningCard = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly action: ReturningCardAction;
};

/** Enough to choose from without becoming a menu. */
export const MAX_RETURNING_CARDS = 4;

export function chooseReturningCards(
  facts: ReturningFacts,
): readonly ReturningCard[] {
  const cards: ReturningCard[] = [];
  // A setup left part-way comes first: it is the one thing only they can
  // finish, and everything else works better once it is done.
  if (facts.unfinished !== null) {
    cards.push(...continueCards(facts.unfinished));
  }
  switch (facts.context.kind) {
    case "INVESTOR":
      cards.push(...investorCards(facts));
      break;
    case "FOUNDER":
      cards.push(...founderCards(facts));
      break;
    case "NONE":
      // Part-way through a setup that has not yet named a company or an
      // organisation: there is nothing of theirs to open, so the other
      // offer is Q itself. Nobody else gets cards -- a person Capital Q
      // knows nothing about is choosing a side, not coming back.
      if (facts.unfinished !== null) {
        cards.push({
          id: "ask",
          title: "Ask Q first",
          description: "Not ready to carry on? Ask Q how the rest works.",
          action: { kind: "ASK_Q", prompt: "How do I get started?" },
        });
      }
      break;
  }
  return cards.slice(0, MAX_RETURNING_CARDS);
}

/**
 * Picking the setup back up, typed or spoken. Both say `from=home` or
 * `talk=1`, which tell the setup screen Q has already welcomed them here,
 * so it goes straight to the question instead of welcoming them again.
 */
function continueCards(journey: "founder" | "investor"): ReturningCard[] {
  const path = `/onboarding/${journey}`;
  return [
    {
      id: "continue-setup",
      title:
        journey === "investor" ? "Continue your mandate" : "Continue setup",
      description: "Pick up at the question we were on.",
      action: { kind: "NAVIGATE", href: `${path}?from=home` },
    },
    {
      id: "talk-setup",
      title: "Talk it through",
      description: "Carry on out loud; Q asks, you answer.",
      action: { kind: "NAVIGATE", href: `${path}?talk=1` },
    },
  ];
}

function investorCards(facts: ReturningFacts): ReturningCard[] {
  return [
    {
      id: "feed",
      title: "Your feed",
      description:
        facts.feed === "YES"
          ? "Companies ranked against your mandate, with the reasons alongside."
          : facts.feed === "NO"
            ? "Nothing matches your mandate yet. See what is there, and why."
            : "Companies ranked against your mandate.",
      action: { kind: "NAVIGATE", href: "/discover" },
    },
    {
      id: "mandate",
      title: "Your mandate",
      description: "Ask Q what you have told Capital Q you invest in.",
      action: { kind: "ASK_Q", prompt: "What is my mandate?" },
    },
    {
      id: "visibility",
      title: "Who can see you",
      description:
        "Whether founders can find you, and what they would see. Nothing is visible until you choose.",
      action: { kind: "NAVIGATE", href: "/company/visibility" },
    },
  ];
}

function founderCards(facts: ReturningFacts): ReturningCard[] {
  const cards: ReturningCard[] = [];
  if (facts.context.kind === "FOUNDER") {
    // Always true here; narrowed so the company id is in reach.
    cards.push({
      id: "company",
      title: "Your company profile",
      description:
        "What Capital Q knows about your company, and what investors would see.",
      action: {
        kind: "NAVIGATE",
        href: `/company/${encodeURIComponent(facts.context.companyId)}`,
      },
    });
  }
  cards.push(
    facts.pitch === "NO"
      ? {
          id: "pitch",
          title: "Record your pitch",
          description:
            "A short video investors watch before they read anything else.",
          action: { kind: "NAVIGATE", href: "/pitch" },
        }
      : {
          id: "pitch",
          title: "Your pitch video",
          description:
            facts.pitch === "YES"
              ? "Review it, or record a new one."
              : "The short video investors watch first.",
          action: { kind: "NAVIGATE", href: "/pitch" },
        },
  );
  const deck = deckCard(facts);
  if (deck !== null) cards.push(deck);
  cards.push({
    id: "investors",
    title: "Investors",
    description:
      "Investors who made themselves discoverable, and why they might fit.",
    action: { kind: "NAVIGATE", href: "/discover" },
  });
  return cards;
}

/**
 * The deck card, or none. A deck Q already prepared opens; one they
 * uploaded is something to ask Q about; with neither, Q offers to draft
 * one. Asking Q to prepare a deck is a request Q answers through its own
 * approval path -- the card does not create anything itself. When it is
 * not known whether a deck exists, no card claims either.
 */
function deckCard(facts: ReturningFacts): ReturningCard | null {
  if (facts.context.kind !== "FOUNDER") return null;
  switch (facts.deck.kind) {
    case "PREPARED":
      return {
        id: "deck",
        title: "Your investor deck",
        description:
          "The deck Q prepared with you. Open it, or ask Q to change it.",
        // Beside the conversation, in Q's own viewer, not a separate page.
        action: { kind: "OPEN_ARTIFACT", artifactId: facts.deck.artifactId },
      };
    case "UPLOADED":
      return {
        id: "deck",
        title: "Your deck",
        description: "Ask Q what an investor would question first.",
        action: {
          kind: "ASK_Q",
          prompt: "What in my deck would an investor question first?",
        },
      };
    case "NONE":
      return {
        id: "deck",
        title: "Create your investor deck",
        description: "Q drafts one from what you have already shared.",
        action: {
          kind: "ASK_Q",
          prompt: "Create an investor deck for my company.",
        },
      };
    case "UNKNOWN":
      return null;
  }
}
