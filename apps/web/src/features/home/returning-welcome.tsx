"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ChevronRight, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { askQAction, type QSubjectInput } from "@/features/q/actions";
import { useQSurfaceTools } from "@/features/q/q-surface-tools";

import { ArrivalBriefing } from "@/features/briefing/arrival-briefing";
import { useArrivalStatus } from "@/features/briefing/arrival-store";

import type { Briefing } from "./briefing";
import { QBriefing } from "./q-briefing";
import type { ReturningCard, ReturningGreeting } from "./returning";
import { remindSetupLaterAction } from "./setup-nudge-actions";
import { useClaimWhenSeen } from "./use-claim-when-seen";

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
  "group flex min-h-11 w-full items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-3.5 py-2.5 text-left",
  "transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border-strong) hover:bg-(--cq-surface-subtle)",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
  "disabled:cursor-progress disabled:opacity-70",
].join(" ");

function CardBody({ card }: { readonly card: ReturningCard }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="cq-body-sm font-medium text-(--cq-text-primary)">
          {card.title}
        </span>
        {/* The title says where it goes; the line under it is for
            assistive technology only (minimal Home, 2026-09-29). */}
        <span className="sr-only">{card.description}</span>
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

export function ReturningWelcome({
  greeting,
  cards,
  subject,
  briefing,
}: {
  readonly greeting: ReturningGreeting;
  readonly cards: readonly ReturningCard[];
  /** The person's own company or organisation, resolved on the server. */
  readonly subject: QSubjectInput | undefined;
  /** Q's briefing (R35), streamed from the server after the page. */
  readonly briefing?: Promise<Briefing | null> | undefined;
}) {
  const router = useRouter();
  const tools = useQSurfaceTools();
  const arrival = useArrivalStatus();
  const arrived = arrival.kind === "READY" && !arrival.nudge;
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Today's setup reminder, when this welcome carries it: counted once the
  // cards are really seen, and gone at once on Later.
  const [putOff, setPutOff] = useState(false);
  const reminding = !putOff && cards.some((card) => card.reminder === true);
  const cardsRef = useRef<HTMLUListElement>(null);
  useClaimWhenSeen(cardsRef, reminding);
  const shownCards = putOff
    ? cards.filter((card) => card.reminder !== true)
    : cards;

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
        fallback={
          <div className="flex flex-col items-center gap-2 text-center">
            <h1
              id="returning-headline"
              className="cq-title-lg text-balance text-(--cq-text-primary)"
            >
              {greeting.headline}
            </h1>
            <p className="cq-body-lg cq-prose text-balance text-(--cq-text-secondary)">
              {greeting.question}
            </p>
          </div>
        }
      />

      {greeting.leftOff === null || putOff ? null : (
        // Q's own last question, as Q asked it: where they left off is
        // shown, not paraphrased.
        <figure
          className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-1 border-l-2 border-(--cq-border-strong) pl-3"
          data-q-left-off
        >
          <figcaption className="cq-caption text-(--cq-text-tertiary)">
            Where we left off
          </figcaption>
          <blockquote className="cq-body text-(--cq-text-primary)">
            {greeting.leftOff}
          </blockquote>
        </figure>
      )}

      {/* The arrival briefing carries what waits on them; not said twice. */}
      {briefing === undefined || arrived ? null : (
        <QBriefing briefing={briefing} />
      )}

      {shownCards.length > 0 ? (
        <ul
          ref={cardsRef}
          aria-label="Where to start"
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
          Remind me later
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
