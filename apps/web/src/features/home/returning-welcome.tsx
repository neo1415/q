"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChevronRight, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { QMark } from "@capital-q/ui/q-mark";

import { askQAction, type QSubjectInput } from "@/features/q/actions";

import type { ReturningCard, ReturningGreeting } from "./returning";

/**
 * Q welcoming somebody back (CQ-WEB-030).
 *
 * Q's greeting in its own words, and a few places to go next, chosen on
 * the server from what Capital Q knows about this person. The
 * conversation is directly underneath: the cards are shortcuts into the
 * product, never a replacement for asking.
 *
 * A card goes somewhere real or asks Q something real. Asking starts an
 * ordinary run through the same server action the composer uses, then
 * opens that conversation on Home, where the panel follows the run from
 * its cursor -- nothing is answered here and nothing is simulated.
 */

const CARD_CLASS = [
  "group flex min-h-11 w-full items-center gap-3 rounded-md border border-(--cq-border) bg-(--cq-surface) px-4 py-3 text-left",
  "transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border-strong) hover:bg-(--cq-surface-subtle)",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
  "disabled:cursor-progress disabled:opacity-70",
].join(" ");

function CardBody({ card }: { readonly card: ReturningCard }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="cq-body font-medium text-(--cq-text-primary)">
          {card.title}
        </span>
        <span className="cq-body-sm text-(--cq-text-secondary)">
          {card.description}
        </span>
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
}: {
  readonly greeting: ReturningGreeting;
  readonly cards: readonly ReturningCard[];
  /** The person's own company or organisation, resolved on the server. */
  readonly subject: QSubjectInput | undefined;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ask = async (card: ReturningCard, prompt: string) => {
    if (asking !== null) return;
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
      className="mx-auto flex w-full max-w-(--cq-layout-reading) flex-col gap-5"
      data-q-returning
    >
      <div className="flex items-start gap-3">
        <span className="mt-1 shrink-0">
          <QMark size="md" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            id="returning-headline"
            className="cq-title-lg text-balance text-(--cq-text-primary)"
          >
            {greeting.headline}
          </h1>
          <p className="cq-body-lg text-(--cq-text-secondary)">
            {greeting.question}
          </p>
        </div>
      </div>

      {cards.length > 0 ? (
        <ul
          aria-label="Where to start"
          className="grid gap-3 sm:grid-cols-2"
          data-q-returning-cards
        >
          {cards.map((card) => {
            const action = card.action;
            return (
              <li key={card.id} className="flex">
                {action.kind === "NAVIGATE" &&
                action.href.startsWith("/api/") ? (
                  // A document the server renders (a prepared deck), not an
                  // application route: a plain link, so the router does not
                  // try to fetch it as a page first.
                  <a
                    href={action.href}
                    className={CARD_CLASS}
                    data-returning-card={card.id}
                  >
                    <CardBody card={card} />
                  </a>
                ) : action.kind === "NAVIGATE" ? (
                  <Link
                    href={action.href}
                    className={CARD_CLASS}
                    data-returning-card={card.id}
                  >
                    <CardBody card={card} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={CARD_CLASS}
                    onClick={() => void ask(card, action.prompt)}
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
