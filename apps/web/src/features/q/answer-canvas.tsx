"use client";

import "./answer-canvas.css";

import { AnimatePresence, LazyMotion, m, useReducedMotion } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";

import type {
  QAnswerCard,
  QAnswerCardLevel,
  QAnswerCardsBlock,
} from "@capital-q/contracts";
import {
  Check,
  ChevronRight,
  ICON_SIZE,
  ICON_STROKE,
  MoreHorizontal,
  Pin,
  X,
} from "@capital-q/ui/icons";

import {
  canvasLayout,
  comparesAsTable,
  fitNumber,
  fitProvenance,
  fitWords,
  tieLine,
  LEVEL_WORD,
} from "./answer-canvas-logic";
import { MapBody } from "./blocks/data-blocks";
import {
  cardPagePath,
  openCardPage,
  openSubjectPage,
  subjectPagePath,
} from "./client-actions";

/**
 * Q's answer as cards on the Q page (C1-C3; mockup answer-canvas.html).
 *
 * One card per thing Q found, each in its own colour with its rank, its
 * fit out of 10 in a number and words, three reasons and the measures
 * with a word and a shape each (never colour alone). The card Q is
 * talking about is open and wide; the rest are narrow (desktop) or
 * half-width tiles (a phone, from four cards). A comparison whose cards
 * share their measures is one table. Every card has an X, and so does
 * the whole answer.
 */

const loadFeatures = () =>
  import("./answer-canvas-motion").then((module) => module.default);

const WIDE_QUERY = "(min-width: 761px)";
const BASIS_LABEL = "Why they fit (from what they publish)";
function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function useWideCanvas(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () =>
      typeof window.matchMedia !== "function" ||
      window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

/** A measure's level as a shape: full, half, ring, dashed ring. */
export function LevelShape({ level }: { readonly level: QAnswerCardLevel }) {
  return (
    <span className="cq-ac-lvl-ink" data-level={level}>
      <svg className="cq-ac-lvl" viewBox="0 0 12 12" aria-hidden="true">
        {level === "STRONG" ? (
          <circle cx="6" cy="6" r="5" fill="currentColor" />
        ) : level === "GOOD" ? (
          <>
            <circle
              cx="6"
              cy="6"
              r="4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path d="M6 1.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
          </>
        ) : level === "PARTIAL" ? (
          <circle
            cx="6"
            cy="6"
            r="4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        ) : (
          <circle
            cx="6"
            cy="6"
            r="4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray="2 2"
          />
        )}
      </svg>
    </span>
  );
}

function Icon({ of: Of }: { readonly of: typeof X }) {
  return (
    <Of aria-hidden="true" size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} />
  );
}

export type AnswerCardActions = {
  readonly onFocus?: ((index: number) => void) | undefined;
  readonly onCloseCard?: ((key: string) => void) | undefined;
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onPin?: ((card: QAnswerCard) => void) | undefined;
  readonly onOpenProfile?: ((card: QAnswerCard) => void) | undefined;
};

function AnswerCard({
  card,
  rank,
  state,
  reduced,
  actions,
  tie = null,
  spot = false,
}: {
  /** In the spotlight: the one large card (a label says so, not colour alone). */
  readonly spot?: boolean | undefined;
  readonly card: QAnswerCard;
  readonly rank: number;
  readonly state: "focus" | "rest";
  readonly reduced: boolean;
  readonly actions: AnswerCardActions;
  /** G-D17: this card's tie with others on mandate fit, said in words. */
  readonly tie?: string | null | undefined;
}) {
  const number = fitNumber(card);
  const words = fitWords(card);
  const provenance = fitProvenance(card);
  // K5: a card with a record behind it has an explicit Open control; a
  // tap on the card itself keeps the spotlight (founder-requested).
  const opens = cardPagePath(card.subject) !== null;
  return (
    <m.article
      layout={reduced ? false : "position"}
      initial={reduced ? false : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
      transition={{ duration: reduced ? 0 : 0.38, ease: [0.23, 1, 0.32, 1] }}
      // Spotlight: the same card moves between the strip and the spotlight
      // (reduced motion: no layout animation, the state just changes).
      {...(reduced ? {} : { layoutId: `cq-ac-${card.key}` })}
      className="cq-ac-card"
      data-state={state}
      data-ac-card={card.key}
      data-ac-spot={spot ? "" : undefined}
      data-hue={String(card.hue)}
      aria-current={state === "focus" ? "true" : undefined}
    >
      <header className="cq-ac-head">
        <span className="cq-ac-rank" aria-hidden="true">
          {rank}
        </span>
        <button
          type="button"
          className="cq-ac-head-main border-0 bg-transparent p-0 text-left"
          onClick={() => actions.onFocus?.(rank - 1)}
          aria-expanded={state === "focus"}
        >
          {spot ? (
            <span className="cq-ac-spot-label" data-ac-spot-label>
              In focus
            </span>
          ) : null}
          <h3>
            <span className="sr-only">{`Number ${String(rank)}: `}</span>
            {card.name}
            <span
              className="cq-ac-talking"
              role="img"
              aria-label="Q is talking about this"
            >
              <i />
              <i />
              <i />
            </span>
          </h3>
          {card.line === null ? null : (
            <p className="cq-ac-line">{card.line}</p>
          )}
          {provenance === null ? null : (
            // G-D17: how the mandate fit was made, on the card's face.
            <p className="cq-ac-line" data-ac-fit-provenance>
              {provenance}
            </p>
          )}
          {tie === null ? null : (
            <p className="cq-ac-line" data-ac-fit-tie>
              {tie}
            </p>
          )}
        </button>
        {number === null ? (
          <span aria-hidden="true" />
        ) : (
          <div
            className="cq-ac-score"
            aria-label={words ?? undefined}
            role="img"
          >
            <span className="num" aria-hidden="true">
              {number}
            </span>
            <span className="of" aria-hidden="true">
              mandate fit, out of 10
            </span>
          </div>
        )}
        {opens ? (
          <button
            type="button"
            className="cq-ac-open"
            aria-label={`Open ${card.name}`}
            onClick={() => {
              if (actions.onOpenProfile !== undefined) {
                actions.onOpenProfile(card);
              } else {
                openCardPage(card.subject);
              }
            }}
            data-ac-open={card.key}
          >
            Open
          </button>
        ) : null}
        <button
          type="button"
          className="cq-ac-x"
          aria-label={`Close ${card.name}`}
          onClick={() => actions.onCloseCard?.(card.key)}
          data-ac-close={card.key}
        >
          <Icon of={X} />
        </button>
      </header>
      <div className="cq-ac-body">
        {/* Closed, its body is out of reach (no hidden tab stops). */}
        <div className="inner" inert={state !== "focus"}>
          <div className="cq-ac-pad">
            <ul className="cq-ac-why">
              {card.reasons.map((reason) => (
                <li key={reason}>
                  <Check
                    aria-hidden="true"
                    size={16}
                    strokeWidth={ICON_STROKE}
                  />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
            {card.measures.length === 0 ? null : (
              <dl className="cq-ac-params">
                {card.measures.map((measure) => (
                  <div key={measure.label}>
                    <dt>{measure.label}</dt>
                    <dd>
                      <LevelShape level={measure.level} />
                      {LEVEL_WORD[measure.level]}
                    </dd>
                    {measure.value === null ? null : (
                      <dd className="val">{measure.value}</dd>
                    )}
                  </div>
                ))}
              </dl>
            )}
            {card.fit === null && card.sourceCount > 0 ? (
              <span className="cq-ac-btn cq-ac-sources" data-ac-sources>
                <Icon of={ChevronRight} />
                {`From ${String(card.sourceCount)} ${card.sourceCount === 1 ? "source" : "sources"}`}
              </span>
            ) : null}
            {card.fitBasis === undefined ||
            card.fitBasis.length === 0 ? null : (
              // E4 (Q.05): why they fit, from what they publish (code, from
              // the run's own reads; never a private mandate).
              <div className="flex flex-col gap-1" data-ac-fit-basis>
                <p className="cq-caption m-0 text-(--cq-text-tertiary)">
                  {BASIS_LABEL}
                </p>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {card.fitBasis.map((line) => (
                    <li
                      key={line}
                      className="cq-body-sm text-(--cq-text-secondary)"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {card.view === null ? null : (
              <p className="cq-body-sm m-0 text-(--cq-text-secondary)">
                <span className="text-(--cq-text-primary)">Q’s view: </span>
                {card.view}
              </p>
            )}
            <div className="cq-ac-actions">
              {/* Wired by default (R0, live 2026-10-06: no surface passed
                  a handler, so the button never opened anything). */}
              {card.subject !== null &&
              subjectPagePath(card.subject) !== null ? (
                <button
                  type="button"
                  className="cq-ac-btn"
                  data-ac-open-profile
                  onClick={() => {
                    if (actions.onOpenProfile !== undefined) {
                      actions.onOpenProfile(card);
                    } else if (card.subject !== null) {
                      openSubjectPage(card.subject);
                    }
                  }}
                >
                  {card.subject.kind === "DOCUMENT"
                    ? "Open document"
                    : "Open profile"}
                </button>
              ) : null}
              {actions.onAsk === undefined ? null : (
                <button
                  type="button"
                  className="cq-ac-btn"
                  onClick={() =>
                    actions.onAsk?.(`Tell me more about ${card.name}.`)
                  }
                >
                  Ask about this
                </button>
              )}
              {actions.onPin === undefined ? null : (
                <button
                  type="button"
                  className="cq-ac-x"
                  aria-label={`Pin ${card.name} to the Board`}
                  onClick={() => actions.onPin?.(card)}
                >
                  <Icon of={Pin} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="cq-ac-oneline" aria-hidden={state === "focus"}>
        {card.reasons[0]}
      </p>
    </m.article>
  );
}

function CompareTable({
  block,
  focus,
  onClose,
  onPin,
}: {
  readonly block: QAnswerCardsBlock;
  readonly focus: number;
  readonly onClose?: (() => void) | undefined;
  readonly onPin?: (() => void) | undefined;
}) {
  const cards = block.cards;
  const labels = cards[0]?.measures.map((measure) => measure.label) ?? [];
  const hasView = cards.some((card) => card.view !== null);
  // E4 (Q.05): why each fits, from what they publish (code-written).
  const hasBasis = cards.some(
    (card) => card.fitBasis !== undefined && card.fitBasis.length > 0,
  );
  const cell = (index: number) => (index === focus ? "on" : undefined);
  return (
    <div className="cq-ac-compare" data-ac-compare>
      <div className="cq-ac-compare-head">
        <h3>Side by side</h3>
        <div className="flex">
          {onPin === undefined ? null : (
            <button
              type="button"
              className="cq-ac-x"
              aria-label="Pin to the Board"
              onClick={onPin}
            >
              <Icon of={Pin} />
            </button>
          )}
          <button
            type="button"
            className="cq-ac-x"
            aria-label="More: ask Q for a file of this"
            title="Ask Q for a file of this"
          >
            <Icon of={MoreHorizontal} />
          </button>
          {onClose === undefined ? null : (
            <button
              type="button"
              className="cq-ac-x"
              aria-label="Close the comparison"
              onClick={onClose}
            >
              <Icon of={X} />
            </button>
          )}
        </div>
      </div>
      <table className="cq-ac-table">
        <thead>
          <tr>
            <th className="blank" aria-hidden="true" />
            {cards.map((card, index) => (
              <th
                key={card.key}
                scope="col"
                className={cell(index)}
                data-hue={String(card.hue)}
              >
                <span className="cname">
                  <span className="cq-ac-rank" aria-hidden="true">
                    {index + 1}
                  </span>
                  {card.name}
                </span>
                {card.fit === null ? null : (
                  <div
                    className="cscore"
                    aria-label={fitWords(card) ?? undefined}
                  >
                    {card.fit.score.toFixed(1)}
                    <small>mandate fit, of 10</small>
                  </div>
                )}
                {/* G-D17: how it was made, and a tie said as a tie. */}
                {fitProvenance(card) === null ? null : (
                  <small className="block" data-ac-fit-provenance>
                    {fitProvenance(card)}
                  </small>
                )}
                {tieLine(block, card) === null ? null : (
                  <small className="block" data-ac-fit-tie>
                    {tieLine(block, card)}
                  </small>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, row) => [
            <tr key={`${label}-label`} className="label" aria-hidden="true">
              <td colSpan={cards.length}>{label}</td>
            </tr>,
            <tr key={label}>
              <th scope="row">{label}</th>
              {cards.map((card, index) => {
                const measure = card.measures[row];
                if (measure === undefined) return <td key={card.key} />;
                return (
                  <td
                    key={card.key}
                    className={cell(index)}
                    data-hue={String(card.hue)}
                  >
                    <span className="v">
                      <LevelShape level={measure.level} />
                      {LEVEL_WORD[measure.level]}
                    </span>
                    {measure.value === null ? null : (
                      <span className="s">{measure.value}</span>
                    )}
                  </td>
                );
              })}
            </tr>,
          ])}
          {hasView
            ? [
                <tr key="view-label" className="label" aria-hidden="true">
                  <td colSpan={cards.length}>Q’s view</td>
                </tr>,
                <tr key="view">
                  <th scope="row">Q’s view</th>
                  {cards.map((card, index) => (
                    <td
                      key={card.key}
                      className={cell(index)}
                      data-hue={String(card.hue)}
                    >
                      {card.view ?? "Not stated"}
                    </td>
                  ))}
                </tr>,
              ]
            : null}
          {hasBasis
            ? [
                <tr key="basis-label" className="label" aria-hidden="true">
                  <td colSpan={cards.length}>{BASIS_LABEL}</td>
                </tr>,
                <tr key="basis" data-ac-fit-basis>
                  <th scope="row">{BASIS_LABEL}</th>
                  {cards.map((card, index) => (
                    <td
                      key={card.key}
                      className={cell(index)}
                      data-hue={String(card.hue)}
                    >
                      {card.fitBasis === undefined || card.fitBasis.length === 0
                        ? "Nothing published read"
                        : card.fitBasis.join("; ")}
                    </td>
                  ))}
                </tr>,
              ]
            : null}
        </tbody>
      </table>
    </div>
  );
}

/** A card out of the spotlight: small, named, one tap to bring it forward. */
function StripCard({
  card,
  rank,
  reduced,
  onFocus,
}: {
  readonly card: QAnswerCard;
  readonly rank: number;
  readonly reduced: boolean;
  readonly onFocus?: ((index: number) => void) | undefined;
}) {
  const number = fitNumber(card);
  return (
    <m.button
      type="button"
      {...(reduced ? {} : { layoutId: `cq-ac-${card.key}` })}
      transition={{ duration: reduced ? 0 : 0.32, ease: [0.23, 1, 0.32, 1] }}
      className="cq-ac-stripcard"
      data-hue={String(card.hue)}
      data-ac-card={card.key}
      data-ac-strip
      aria-label={`Bring ${card.name} forward`}
      onClick={() => onFocus?.(rank - 1)}
    >
      <span className="cq-ac-rank" aria-hidden="true">
        {rank}
      </span>
      <span className="cq-ac-stripname">{card.name}</span>
      {number === null ? null : (
        <span className="cq-ac-stripfit">{number}</span>
      )}
    </m.button>
  );
}

export type AnswerCanvasProps = AnswerCardActions & {
  readonly block: QAnswerCardsBlock;
  /** What was asked, above what Q is saying. */
  readonly asked?: string | undefined;
  /** What Q is saying now; omitted in a static view (chat, Board). */
  readonly said?: string | undefined;
  /** The card Q is talking about; -1 for none (the overview). */
  readonly focus: number;
  /** Q's presence, small, beside what it says. */
  readonly presence?: ReactNode;
  readonly dismissed?: ReadonlySet<string> | undefined;
  readonly onCloseAll?: (() => void) | undefined;
  readonly onFollowUp?: ((question: string) => void) | undefined;
  readonly showFollowUps?: boolean | undefined;
  /**
   * The card the conversation is about (spotlight.ts): it is the one large
   * card and the others shrink to a strip; null or absent: all level.
   */
  readonly spotlight?: number | null | undefined;
};

export function AnswerCanvas({
  block,
  asked,
  said,
  focus,
  presence,
  dismissed,
  onCloseAll,
  onFollowUp,
  showFollowUps = true,
  spotlight = null,
  ...actions
}: AnswerCanvasProps) {
  const wide = useWideCanvas();
  const reduced = useReducedMotion() === true;
  const shown = block.cards.filter((card) => dismissed?.has(card.key) !== true);
  const { layout, tiles } = canvasLayout(shown.length, wide);
  const table = comparesAsTable(block) && shown.length === block.cards.length;
  const spotKey = spotlight === null ? undefined : block.cards[spotlight]?.key;
  const spotCard = shown.find((card) => card.key === spotKey);
  const spot = !table && spotCard !== undefined && shown.length >= 2;
  const focusKey = spot ? spotKey : block.cards[focus]?.key;

  return (
    <LazyMotion features={loadFeatures} strict>
      <section
        className="cq-ac"
        aria-label={block.title}
        data-ac-shape={block.shape}
        data-ac
      >
        {said === undefined ? null : (
          <div className="cq-ac-speakline">
            <div className="cq-ac-mini">{presence}</div>
            <div className="min-w-0">
              <p className="cq-ac-asked">{asked ?? block.title}</p>
              <p className="cq-ac-said" aria-live="polite" data-ac-said>
                {said}
              </p>
            </div>
            {onCloseAll === undefined ? (
              <span />
            ) : (
              <button
                type="button"
                className="cq-ac-x"
                aria-label="Close this answer"
                onClick={onCloseAll}
                data-ac-close-all
              >
                <Icon of={X} />
              </button>
            )}
          </div>
        )}
        {table ? (
          <CompareTable
            block={block}
            focus={focus}
            onClose={onCloseAll}
            onPin={
              actions.onPin === undefined
                ? undefined
                : () => block.cards[0] && actions.onPin?.(block.cards[0])
            }
          />
        ) : spot ? (
          // The spotlight: the card the conversation is about, large; the
          // others a strip of small cards, each one tap from the spotlight.
          <div
            className="cq-ac-cards"
            data-layout="spotlight"
            data-n={String(shown.length)}
            data-focus="one"
            data-spotlight={spotCard.key}
            data-ac-cards
          >
            <div className="cq-ac-spot">
              <AnswerCard
                key={spotCard.key}
                card={spotCard}
                rank={block.cards.indexOf(spotCard) + 1}
                tie={tieLine(block, spotCard)}
                state="focus"
                reduced={reduced}
                actions={actions}
                spot
              />
            </div>
            <ul className="cq-ac-strip" aria-label="The other results">
              {shown
                .filter((card) => card.key !== spotCard.key)
                .map((card) => (
                  <li key={card.key}>
                    <StripCard
                      card={card}
                      rank={block.cards.indexOf(card) + 1}
                      reduced={reduced}
                      onFocus={actions.onFocus}
                    />
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <div
            className="cq-ac-cards"
            data-layout={layout}
            data-n={String(shown.length)}
            data-tiles={tiles ? "" : undefined}
            data-focus={focusKey === undefined ? "none" : "one"}
            data-ac-cards
          >
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((card) => (
                <AnswerCard
                  key={card.key}
                  card={card}
                  rank={block.cards.indexOf(card) + 1}
                  tie={tieLine(block, card)}
                  state={card.key === focusKey ? "focus" : "rest"}
                  reduced={reduced}
                  actions={actions}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
        {block.map === undefined ? null : (
          // E4: where the cards' subjects are, from the run's reads.
          <div className="cq-ac-map" data-ac-map>
            <p className="cq-body-sm m-0 font-semibold text-(--cq-text-primary)">
              {block.map.title}
            </p>
            <MapBody map={block.map} />
          </div>
        )}
        {showFollowUps &&
        focus < 0 &&
        block.followUps.length > 0 &&
        onFollowUp !== undefined ? (
          <div
            className="cq-ac-followups"
            role="group"
            aria-label="Ask next"
            data-ac-followups
          >
            {block.followUps.map((question) => (
              <button
                key={question}
                type="button"
                className="cq-ac-chip"
                onClick={() => onFollowUp(question)}
              >
                {question}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </LazyMotion>
  );
}

/**
 * The answer flies into the Board button (C4), then the caller drops it
 * from the stage. Positions only, from where each card is to the button;
 * reduced motion (or no button on screen) skips straight to the end.
 */
export async function flyToBoard(container: HTMLElement | null): Promise<void> {
  if (container === null) return;
  const target = document.querySelector('[data-q-control="board"]');
  const reduced =
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (target === null || reduced) return;
  const to = target.getBoundingClientRect();
  const pieces = [
    ...container.querySelectorAll<HTMLElement>(
      "[data-ac-card], [data-ac-compare]",
    ),
  ];
  const flights = pieces.map((piece, index) => {
    const from = piece.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    piece.style.pointerEvents = "none";
    return piece.animate(
      [
        { transform: "none", opacity: 1 },
        {
          transform: `translate(${String(dx)}px, ${String(dy)}px) scale(0.08)`,
          opacity: 0.2,
        },
      ],
      {
        duration: 560,
        delay: index * 50,
        easing: "cubic-bezier(0.77, 0, 0.175, 1)",
        fill: "forwards",
      },
    ).finished;
  });
  await Promise.allSettled(flights);
}
