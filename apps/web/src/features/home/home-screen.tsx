import type { ReactNode } from "react";

import { loadWebServerConfig } from "@capital-q/config/web";

import { accountDetails } from "@/auth/account-details";
import {
  resolveOwnContext,
  resolveUnfinishedSetup,
  type OwnContext,
} from "@/features/q/context";
import {
  QConversationPanel,
  type QSurfaceContext,
} from "@/features/q/q-conversation";
import { PersonaCards } from "@/features/persona/persona-cards";
import { WorkPanel } from "@/features/work/work-panel";
import type { QSubjectInput } from "@/features/q/actions";

import {
  arrivalFor,
  chooseReturningCards,
  firstName,
  returningGreeting,
  type ReturningFacts,
} from "./returning";
import type { Briefing } from "./briefing";
import { resolveBriefing } from "./briefing-facts";
import { resolveReturningFacts } from "./returning-facts";
import { ReturningWelcome } from "./returning-welcome";
import { resolveSetupReminder } from "./setup-reminder";

/**
 * Home is Q (QX-001 §4; doc 17 §60-§63; acceptance A and K).
 *
 * Not a dashboard with a chatbot in the corner, and not a dashboard at
 * all. Home is the same living Q a new person meets at first run: its
 * presence at the head of the workspace, Q's welcome said beneath it with
 * a few small choices, then the conversation and the composer. Typing,
 * talking, research, the documents Q makes and the history of what was
 * said all happen here, in this one surface.
 *
 * What used to sit underneath -- "Finish setting up", "Visibility &
 * Discovery", the choice of side under a heading -- is now what Q offers
 * in its welcome, so a returning person meets one greeting that knows
 * where they are, instead of a page of sections around a chat box.
 *
 * Whether this build can reach Q is a server-side fact, resolved here and
 * passed down as a boolean — the browser is told what is available, never
 * where. Nothing on this screen comes from a fixture.
 */

function surfaceContext(context: OwnContext): QSurfaceContext {
  switch (context.kind) {
    case "FOUNDER":
      return {
        companyId: context.companyId,
        scope: "founder_private",
        label: context.label ?? undefined,
        // Only what Q can actually answer from what is on record. A
        // shortcut that produces a shrug is worse than one fewer chip.
        suggestions: [
          "How is my raise going?",
          "What should I fix before investors see this?",
          "What did my deck say about our customers?",
          "Review my company",
        ],
      };
    case "INVESTOR":
      return {
        investorOrganisationId: context.investorOrganisationId,
        scope: "investor_private",
        label: context.label ?? undefined,
        suggestions: [
          "What is my mandate?",
          "What are my hard exclusions?",
          "What should I look at?",
        ],
      };
    case "NONE":
      return {
        scope: "unset",
        suggestions: [
          "What can you help me with?",
          "Who are you?",
          "How do I get started?",
        ],
      };
  }
}

/** The person's own subject, for a question a welcome card asks Q. */
function askSubject(context: OwnContext): QSubjectInput | undefined {
  switch (context.kind) {
    case "FOUNDER":
      return { companyId: context.companyId };
    case "INVESTOR":
      return { investorOrganisationId: context.investorOrganisationId };
    case "NONE":
      return undefined;
  }
}

/** The one line under Q, in the person's terms rather than the product's. */
function openingLine(context: OwnContext): string {
  if (context.kind === "NONE" && context.unavailable === true) {
    // Not known to be new: Capital Q did not answer (CQ-VERIFY-001).
    return "Capital Q didn't answer just now, so I can't show where you left off. Ask me anything, or try again in a moment.";
  }
  switch (context.kind) {
    case "FOUNDER":
      return "Ask about your company, your raise, or what to do next.";
    case "INVESTOR":
      return "Ask about your mandate, what to look at, or what changed.";
    case "NONE":
      return "Ask Q anything, or tell Q what you're here to do.";
  }
}

/** First-run words, the same ones the arrival welcome uses for its choice. */
const FIRST_RUN_QUESTION = "Are you here to raise capital, or to invest it?";

/**
 * Somebody Capital Q knows nothing about yet, who came to Home rather than
 * through the first-run welcome: Q introduces itself and asks the one
 * question that decides everything after it, with both answers on screen.
 */
function FirstRunWelcome({ name }: { readonly name: string | null }) {
  return (
    <section
      aria-labelledby="first-run-headline"
      className="flex w-full flex-col items-center gap-5"
      data-q-first-run
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h1
          id="first-run-headline"
          className="cq-title-lg text-balance text-(--cq-text-primary)"
        >
          {name === null ? "Hi, I'm Q." : `Hi ${name}, I'm Q.`}
        </h1>
        <p className="cq-body-lg text-balance text-(--cq-text-secondary)">
          {FIRST_RUN_QUESTION}
        </p>
      </div>
      <div className="w-full">
        <PersonaCards />
      </div>
    </section>
  );
}

export async function HomeScreen({
  conversationId = null,
}: {
  /** The conversation the URL names, resolved on the server. */
  readonly conversationId?: string | null | undefined;
} = {}) {
  const qConnected = loadWebServerConfig().qApiBaseUrl !== undefined;
  // Which subject Q's questions are about, if Capital Q knows of one. A
  // server fact, resolved once per render and never asked of the browser.
  const context = qConnected
    ? await resolveOwnContext()
    : { kind: "NONE" as const };
  // A setup that was left part-way is offered back, in one tap -- to
  // somebody whose setup has not named a company yet as well, who is
  // back rather than new (CQ-WEB-030).
  const unfinished = qConnected ? await resolveUnfinishedSetup() : null;
  const arrival = arrivalFor(context, unfinished);

  /*
    Q's welcome, once, and only before a conversation: an open
    conversation is what they came to Home for, and it is not greeted
    over. Returning: what Capital Q knows about where they are. First
    time: who Q is and which side of the table they are on. Otherwise
    the one line under Q.
  */
  let welcome: ReactNode = undefined;
  let welcomeLine: string | undefined = undefined;
  let welcomeLead: string | undefined = undefined;
  // Whether the page already has its one visible h1 (the welcomes do).
  let headed = false;
  let briefing: Promise<Briefing | null> | undefined = undefined;
  if (conversationId === null) {
    if (arrival === "RETURNING") {
      // Q's briefing (R35) starts now and is not awaited: the page and Q
      // render first, and the briefing streams in when its reads answer.
      briefing = context.kind === "NONE" ? undefined : resolveBriefing(context);
      // Today's setup reminder, read (never claimed) once and given on one
      // surface only: the briefing's card where there is a briefing, this
      // welcome otherwise. No reminder today: neither mentions the setup.
      const [read, reminder] = await Promise.all([
        resolveReturningFacts(context, unfinished),
        unfinished === null ? null : resolveSetupReminder(),
      ]);
      const facts: ReturningFacts = {
        ...read,
        setupReminder:
          reminder === null
            ? undefined
            : briefing === undefined
              ? "WELCOME"
              : "BRIEFING",
      };
      const greeting = returningGreeting(facts);
      welcome = (
        <ReturningWelcome
          greeting={greeting}
          cards={chooseReturningCards(facts)}
          subject={askSubject(context)}
          briefing={briefing}
        />
      );
      welcomeLine = greeting.spoken;
      welcomeLead = greeting.headline;
      headed = true;
    } else if (arrival === "FIRST_TIME" && qConnected) {
      const name = firstName((await accountDetails()).displayName);
      welcome = <FirstRunWelcome name={name} />;
      headed = true;
      welcomeLine = `${name === null ? "Hi, I'm Q." : `Hi ${name}, I'm Q.`} ${FIRST_RUN_QUESTION}`;
    } else {
      welcome = (
        <p className="cq-body text-center text-balance text-(--cq-text-secondary)">
          {openingLine(context)}
        </p>
      );
    }
  }

  return (
    <div className="flex flex-col">
      {/*
        The Q surface. Deliberately not a PageHeader and a card: a heading
        reading "Home" above a boxed chat is the dashboard composition
        this packet exists to replace. Previous conversations are one
        control away (the history control here, the collapsible list in
        the sidebar), never a list above the composer.

        Deliberately not inside a Suspense boundary (QX-003A): React
        reveals a streamed boundary on a requestAnimationFrame, which never
        fires in a hidden tab, and Home's whole Q surface stayed blank in a
        background tab until it was removed.
      */}
      {/*
        AUTO (ADR 0029): what Q is doing under an approved plan, above the
        conversation, only while something is running (renders nothing
        otherwise, so Home stays Q first).
      */}
      {qConnected && !headed ? (
        <div className="mx-auto w-full max-w-(--cq-layout-reading) px-(--cq-page-gutter) pt-4">
          <WorkPanel variant="home" />
        </div>
      ) : null}
      <section aria-label="Ask Q" className="flex flex-col" data-q-surface>
        {/* A conversation view still has a page heading (R30 #34). */}
        {headed ? null : <h1 className="sr-only">Q</h1>}
        <QConversationPanel
          connected={qConnected}
          context={surfaceContext(context)}
          conversationId={conversationId}
          welcome={welcome}
          welcomeLine={welcomeLine}
          welcomeLead={welcomeLead}
          briefing={briefing}
        />
      </section>
    </div>
  );
}
