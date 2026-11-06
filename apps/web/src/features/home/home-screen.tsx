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
import type { QStarter } from "@/features/q/q-starters";
import { loadVerifyNudge } from "@/features/verification/verify-nudge-loader";
import { ArrivalStage } from "@/features/briefing/arrival-stage";
import { warmArrivalSnapshot } from "@/features/briefing/arrival-warm";

import {
  arrivalFor,
  firstName,
  returningGreeting,
  type ReturningFacts,
} from "./returning";
import type { Briefing } from "./briefing";
import { resolveBriefing } from "./briefing-facts";
import { resolveReturningFacts } from "./returning-facts";
import { resolveSetupReminder } from "./setup-reminder";
import { serverT, serverUiLanguage } from "@/features/i18n/server";

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

/** The empty home's one line, with their first name when known. */
function mindLine(name: string | null): string {
  return name === null
    ? "What's on your mind today?"
    : `What's on your mind today, ${name}?`;
}

/** First-run words, the same ones the arrival welcome uses for its choice. */
const FIRST_RUN_QUESTION = "Are you here to raise capital, or to invest it?";

export async function HomeScreen({
  conversationId = null,
  fresh = false,
  openBoard = false,
  ask,
}: {
  /**
   * Lane ov 2026-10-16: words to start the composer with ("Ask Q about
   * their market", a profile section to tell Q about). Only typed for
   * them; nothing is sent until they press Send.
   */
  readonly ask?: string | undefined;
  /** The conversation the URL names, resolved on the server. */
  readonly conversationId?: string | null | undefined;
  /** "New chat" (`?new=1`): a new conversation; a bare /home keeps this tab's. */
  readonly fresh?: boolean | undefined;
  /** Arrived from the answer chip's Board (C6): open on the Board. */
  readonly openBoard?: boolean | undefined;
} = {}) {
  const qConnected = loadWebServerConfig().qApiBaseUrl !== undefined;
  // Speed lane 2026-10-20: the snapshot Q greets from is built while this
  // page renders and hydrates, not first asked for after hydration.
  if (qConnected) warmArrivalSnapshot();
  // Which subject Q's questions are about, if Capital Q knows of one. A
  // server fact, resolved once per render and never asked of the browser.
  // A setup that was left part-way is offered back, in one tap -- to
  // somebody whose setup has not named a company yet as well, who is
  // back rather than new (CQ-WEB-030). Independent reads, side by side.
  const [t, language, context, unfinished] = await Promise.all([
    serverT(),
    serverUiLanguage(),
    qConnected
      ? resolveOwnContext()
      : Promise.resolve<OwnContext>({ kind: "NONE" }),
    qConnected ? resolveUnfinishedSetup() : Promise.resolve(null),
  ]);
  const arrival = arrivalFor(context, unfinished);

  /*
    Q's welcome, once, and only before a conversation: an open
    conversation is what they came to Home for, and it is not greeted
    over. Returning: what Capital Q knows about where they are. First
    time: who Q is and which side of the table they are on. Otherwise
    the one line under Q.
  */
  let welcomeLine: string | undefined = undefined;
  let welcomeLead: string | undefined = undefined;
  // Client 2026-11-05 ("our Q screen should look like ChatGPT"): the empty
  // home is one greeting line, the composer, and at most three starters --
  // what genuinely waits on the person first (finish setup, verify), then
  // the suggested questions. Q's spoken welcome is unchanged.
  let greeting: string | undefined = undefined;
  const starters: QStarter[] = [];
  let briefing: Promise<Briefing | null> | undefined = undefined;
  if (conversationId === null) {
    if (arrival === "RETURNING") {
      // Q's briefing (R35) starts now and is not awaited: the page and Q
      // render first, and the briefing streams in when its reads answer.
      briefing = context.kind === "NONE" ? undefined : resolveBriefing(context);
      // Today's setup reminder, read (never claimed) once and given on one
      // surface only: the briefing's card where there is a briefing, this
      // welcome otherwise. No reminder today: neither mentions the setup.
      const [read, reminder, nudge] = await Promise.all([
        resolveReturningFacts(context, unfinished),
        unfinished === null ? null : resolveSetupReminder(),
        loadVerifyNudge().catch(() => null),
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
      const spoken = returningGreeting(facts, language);
      welcomeLine = spoken.spoken;
      welcomeLead = spoken.headline;
      greeting = mindLine(firstName(facts.name));
      if (unfinished !== null) {
        starters.push({
          id: "resume-setup",
          label: "Finish setup with Q",
          icon: "setup",
          kind: "GO",
          href: `/onboarding/${unfinished}?from=home`,
        });
      }
      if (nudge !== null) {
        // The verification item, here rather than over the page's top
        // line (client 2026-11-05: the top was cluttered).
        starters.push({
          id: "verify",
          label: nudge.title,
          icon: "verify",
          kind: "GO",
          href: "/verification",
        });
      }
    } else if (arrival === "FIRST_TIME" && qConnected) {
      const name = firstName((await accountDetails()).displayName);
      welcomeLine = `${name === null ? "Hi, I'm Q." : `Hi ${name}, I'm Q.`} ${FIRST_RUN_QUESTION}`;
      // The one question that decides everything after it, with both
      // answers as the starters.
      greeting = FIRST_RUN_QUESTION;
      // The same two ways in as the persona cards (PERSONAS), written
      // here because a client module's constants are references on the
      // server, not values.
      starters.push(
        {
          id: "persona-founder",
          label: "Raising capital",
          icon: "persona",
          kind: "GO",
          href: "/onboarding/founder",
        },
        {
          id: "persona-investor",
          label: "Investing",
          icon: "persona",
          kind: "GO",
          href: "/onboarding/investor",
        },
      );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        Owner 2026-11-06 (asked twice): no "Q is working on N things"
        panel on Home. Running work is on the Board (its count is on the
        top line) and on /work; WorkPanel itself is unchanged there.
      */}
      <section
        aria-label={t("Ask Q")}
        className="flex min-h-0 flex-1 flex-col"
        data-q-surface
      >
        {/* A conversation view still has a page heading (R30 #34). */}
        <h1 className="sr-only">Q</h1>
        <QConversationPanel
          connected={qConnected}
          context={surfaceContext(context)}
          conversationId={conversationId}
          fresh={fresh}
          openBoard={openBoard}
          greeting={greeting}
          starters={starters}
          welcomeLine={welcomeLine}
          welcomeLead={welcomeLead}
          briefing={briefing}
          // E1: what Q did, what needs them and new matches, beside Q for
          // as long as the page lives (not only before the first word).
          stageLayer={arrival === "RETURNING" ? <ArrivalStage /> : undefined}
          initialAsk={ask}
        />
      </section>
    </div>
  );
}
