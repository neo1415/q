"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ChevronRight, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { askQAction, type QSubjectInput } from "@/features/q/actions";
import { useQSurfaceTools } from "@/features/q/q-surface-tools";

import { ArrivalBriefing } from "@/features/briefing/arrival-briefing";
import { OPEN_QUESTION } from "@/features/briefing/opener";
import {
  setArrivalSetupReminders,
  useArrivalStatus,
  useOpener,
} from "@/features/briefing/arrival-store";

import type { Briefing } from "./briefing";
import { QBriefing } from "./q-briefing";
import type { ReturningCard, ReturningGreeting } from "./returning";
import { remindSetupLaterAction } from "./setup-nudge-actions";
import { useClaimWhenSeen } from "./use-claim-when-seen";
import { useT } from "@/features/i18n/language";

/**
 * Q welcoming somebody back (CQ-WEB-030; acceptance A and K).
 *
 * Said under Q's presence, the way the first-run welcome is: Q's greeting
 * from what Capital Q holds, where an unfinished setup left off in Q's
 * own last words, and a few small choices. It sits inside the Q surface
 * rather than above it as a page heading with a dashboard of cards, so
 * the welcome, the conversation and whatever Q makes are one place.
 *
 * A card goes somewhere real, asks Q something real, or opens a document
 * Q already made. Inside the Q surface, asking happens in this
 * conversation and a document opens beside it; elsewhere a card falls
 * back to starting an ordinary run and opening it on Home -- nothing is
 * answered here and nothing is simulated.
 */

const CARD_CLASS = [
  "group flex min-h-11 w-full items-center gap-3 border border-(--cq-border-subtle) bg-(--cq-surface) px-3.5 py-2.5 text-start",
  "transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border-strong) hover:bg-(--cq-surface-subtle)",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
  "disabled:cursor-progress disabled:opacity-70",
].join(" ");

function CardBody({ card }: { readonly card: ReturningCard }) {
  const t = useT();
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="cq-body-sm font-medium text-(--cq-text-primary)">
          {t(card.title)}
        </span>
        {/* The title says where it goes; the line under it is for
            assistive technology only (minimal Home, 2026-09-29). */}
        <span className="sr-only">{t(card.description)}</span>
      </span>
      <ChevronRight
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
        className="shrink-0 text-(--cq-text-tertiary) transition-colors duration-(--cq-motion-fast) group-hover:text-(--cq-text-secondary)"
      />
    </>
  );
}

const RESUME_CARD: ReturningCard = {
  id: "resume-setup",
  title: "Finish setup with Q",
  description: "Q picks up where you left off.",
  action: { kind: "NAVIGATE", href: "/home" },
};

export function ReturningWelcome({
  greeting,
  cards,
  subject,
  briefing,
  setupReminders = 0,
  resume,
}: {
  readonly greeting: ReturningGreeting;
  readonly cards: readonly ReturningCard[];
  /** The person's own company or organisation, resolved on the server. */
  readonly subject: QSubjectInput | undefined;
  /** Q's briefing (R35), streamed from the server after the page. */
  readonly briefing?: Promise<Briefing | null> | undefined;
  /** Today's setup reminder, as `setupRemindersWaiting` counts it. */
  readonly setupReminders?: 0 | 1 | undefined;
  /**
   * The way back into a setup still open, from the server's session state
   * (live 2026-10-29: right after "continue later" Home had no way back,
   * and on a fresh load it came only ~6 s later, with the briefing). Shown
   * at once, never gated on the arrival read or the briefing's reads.
   */
  readonly resume?: { readonly href: string } | undefined;
}) {
  const t = useT();
  const router = useRouter();
  const tools = useQSurfaceTools();
  const arrival = useArrivalStatus();
  // Still being read counts as arrived: on sign-in Q greets and asks
  // before anything is listed (owner 2026-10-16), so the older briefing's
  // cards never flash up first.
  const arrived =
    arrival.kind === "PENDING" || (arrival.kind === "READY" && !arrival.nudge);
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Today's setup reminder, when this welcome carries it: counted once the
  // cards are really seen, and gone at once on Later.
  const [putOff, setPutOff] = useState(false);
  // Owner 2026-10-16: the reminder is one of the things Q's opener counts,
  // and shows with the rest only once they choose to look.
  useEffect(() => {
    setArrivalSetupReminders(setupReminders);
  }, [setupReminders]);
  const looking = useOpener().choice === "SHOW";
  const held = arrived && !looking;
  const reminding =
    !putOff && !held && cards.some((card) => card.reminder === true);
  const cardsRef = useRef<HTMLUListElement>(null);
  useClaimWhenSeen(cardsRef, reminding);
  const shownCards =
    // Owner 2026-10-17: no quick-link cards under the greeting; only an
    // unfinished setup's reminder, which needs them, stays.
    (putOff || held ? [] : cards).filter((card) => card.reminder === true);

  const ask = async (card: ReturningCard, prompt: string) => {
    if (asking !== null) return;
    if (tools !== null) {
      // The conversation right underneath takes it: same run, same place.
      tools.ask(prompt);
      return;
    }
    setAsking(card.id);
    setNotice(null);
    const result = await askQAction(prompt, undefined, subject);
    if (!result.ok) {
      setAsking(null);
      setNotice(result.message);
      return;
    }
    const conversationId = result.value.conversationId;
    if (conversationId === undefined) {
      // The run exists; only the way to open it is missing. Say so
      // rather than pretend the question went nowhere.
      setAsking(null);
      setNotice("Q is answering. You'll find it in your chats.");
      return;
    }
    router.push(`/home?c=${encodeURIComponent(conversationId)}`);
  };

  return (
    <section
      aria-labelledby="returning-headline"
      className="flex w-full flex-col items-center gap-5"
      data-q-returning
    >
      {/*
        The arrival briefing (2026-10-08): greeting by their clock, the
        lowdown, then what needs them, one card at a time. Until it is read,
        and when this is not an arrival, the welcome below shows instead.
      */}
      <ArrivalBriefing
        variant="page"
        // The heading the server rendered stays when the read lands.
        headline={greeting.headline}
        // E1: the cards are the Q stage's layer, which outlives this welcome.
        cards="stage"
        fallback={
          <div className="flex flex-col items-center gap-2 text-center">
            <h1
              id="returning-headline"
              className="cq-title-lg text-balance text-(--cq-text-primary)"
            >
              {greeting.headline}
            </h1>
            <p className="cq-body-lg cq-prose text-balance text-(--cq-text-secondary)">
              {t(OPEN_QUESTION)}
            </p>
          </div>
        }
      />

      {greeting.leftOff === null || putOff || held ? null : (
        // Q's own last question, as Q asked it: where they left off is
        // shown, not paraphrased.
        <figure
          className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-1 border-s-2 border-(--cq-border-strong) ps-3"
          data-q-left-off
        >
          <figcaption className="cq-caption text-(--cq-text-tertiary)">
            {t("Where we left off")}
          </figcaption>
          <blockquote className="cq-body text-(--cq-text-primary)">
            {greeting.leftOff}
          </blockquote>
        </figure>
      )}

      {resume === undefined ||
      shownCards.some((card) => card.id === "continue-setup") ? null : (
        <Link
          href={resume.href}
          className={`${CARD_CLASS} max-w-(--cq-layout-narrow)`}
          data-q-resume-setup
        >
          <CardBody card={RESUME_CARD} />
        </Link>
      )}

      {/* The arrival briefing carries what waits on them; not said twice. */}
      {briefing === undefined ? null : !arrived ? (
        <QBriefing briefing={briefing} />
      ) : looking && setupReminders > 0 ? (
        // The reminder the briefing carries, now they chose to look; the
        // rest of what waits is on the stage already, not said twice.
        <QBriefing briefing={briefing} onlyReminder />
      ) : null}

      {shownCards.length > 0 ? (
        <ul
          ref={cardsRef}
          aria-label={t("Where to start")}
          className="grid w-full gap-2 sm:grid-cols-2"
          data-q-returning-cards
        >
          {shownCards.map((card) => {
            const action = card.action;
            return (
              <li key={card.id} className="flex">
                {action.kind === "NAVIGATE" ? (
                  <Link
                    href={action.href}
                    className={CARD_CLASS}
                    data-returning-card={card.id}
                  >
                    <CardBody card={card} />
                  </Link>
                ) : action.kind === "OPEN_ARTIFACT" && tools === null ? (
                  // Outside a Q surface there is no viewer to open it in;
                  // the slides the server renders are the way in.
                  <a
                    href={`/api/q-artifact/${encodeURIComponent(action.artifactId)}/slides`}
                    className={CARD_CLASS}
                    data-returning-card={card.id}
                  >
                    <CardBody card={card} />
                  </a>
                ) : (
                  <button
                    type="button"
                    className={CARD_CLASS}
                    onClick={() => {
                      if (action.kind === "OPEN_ARTIFACT") {
                        tools?.openArtifact(action.artifactId);
                      } else if (action.kind === "ASK_Q") {
                        void ask(card, action.prompt);
                      }
                    }}
                    disabled={asking !== null}
                    aria-busy={asking === card.id}
                    data-returning-card={card.id}
                  >
                    <CardBody card={card} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {reminding ? (
        <button
          type="button"
          onClick={() => {
            setPutOff(true);
            void remindSetupLaterAction();
          }}
          className="inline-flex min-h-11 items-center rounded-md px-3 cq-body-sm text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
          data-setup-reminder-later
        >
          {t("Remind me next week")}
        </button>
      ) : null}

      {/* Polite, so a failed ask is read out without taking focus. */}
      <p
        role="status"
        className="cq-body-sm text-(--cq-text-secondary) empty:hidden"
      >
        {asking !== null ? "Asking Q…" : (notice ?? "")}
      </p>
    </section>
  );
}
