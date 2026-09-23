"use client";

import Link from "next/link";

import type { QSubjectRef, QUiIntent } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import type { QTurnObjectBlock } from "./conversation";

/**
 * What Q attached to an answer, as things you can act on (QX-001 §8-§10).
 *
 * Three rules hold this together.
 *
 * **Only what the server sent.** Every card below is a projection of one
 * `QResultBlock`. Nothing is inferred, nothing is fetched to fill a card
 * out, and a block the server did not send is a card nobody sees. Today
 * the runtime attaches no blocks at all, so this renders nothing — which
 * is the correct amount of nothing, and the day a specialist starts
 * attaching a company reference it appears without a further change.
 *
 * **Only typed destinations.** An action's target comes from a closed UI
 * intent or an identifier the contract already carries; it is turned into
 * a route here, in code the model cannot reach. There is no `OPEN_URL`,
 * no href from a string field and nothing that could execute. A model
 * that wants to send somebody somewhere may name one of four intents and
 * nothing else.
 *
 * **Not everything is a card.** Prose stays prose. A rounded rectangle is
 * for something you can open, compare, answer or approve — an object with
 * an action, not a paragraph with a border.
 */

/**
 * Where a suggested intent may go, and the answer is usually nowhere yet.
 *
 * The same rule the spoken destinations follow: an intent with no route
 * here is ignored, never guessed. None of the four has a surface today —
 * there is no company detail page and no comparison view — so a
 * UI_INTENT block currently renders nothing at all. That is the honest
 * state, and each one lights up by adding a line here when its screen
 * exists, rather than by shipping a link to a 404 now.
 */
const INTENT_ROUTES: Readonly<Record<QUiIntent["kind"], string | null>> = {
  OPEN_COMPANY: null,
  FOCUS_SECTION: null,
  SHOW_COMPARISON: null,
  SHOW_EVIDENCE: null,
};

function intentHref(intent: QUiIntent): string | null {
  const route = INTENT_ROUTES[intent.kind];
  if (route === null) {
    return null;
  }
  switch (intent.kind) {
    case "OPEN_COMPANY":
    case "FOCUS_SECTION":
      return `${route}?companyId=${encodeURIComponent(intent.companyId)}`;
    case "SHOW_COMPARISON":
      return `${route}?compare=${intent.companyIds.map(encodeURIComponent).join(",")}`;
    case "SHOW_EVIDENCE":
      return route;
  }
}

function intentLabel(intent: QUiIntent): string {
  switch (intent.kind) {
    case "OPEN_COMPANY":
      return "Open the company";
    case "FOCUS_SECTION":
      return "Open that section";
    case "SHOW_COMPARISON":
      return "See them side by side";
    case "SHOW_EVIDENCE":
      return "See the sources";
  }
}

function subjectLabel(subject: QSubjectRef): string {
  switch (subject.kind) {
    case "COMPANY":
      return "Company";
    case "INVESTOR_ORGANISATION":
      return "Investor";
    case "RELATIONSHIP":
      return "Relationship";
    case "CAPITAL_OBJECTIVE":
      return "Raise";
    case "DOCUMENT":
      return "Document";
    case "USER":
      return "Person";
    case "ORGANISATION":
      return "Organisation";
  }
}

/**
 * The shell every result object sits in.
 *
 * One border, one heading, one row of actions. QX-003 extends this for
 * generated artifacts rather than inventing a second card language beside
 * it, which is the whole reason it is a named component and not a div
 * repeated five times below.
 */
export function QResultCard({
  label,
  title,
  children,
  actions,
}: {
  readonly label: string;
  readonly title?: string | undefined;
  readonly children?: React.ReactNode;
  readonly actions?: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
      data-q-result-card
    >
      <div className="flex flex-col gap-1">
        <span className="cq-label text-(--cq-text-tertiary)">{label}</span>
        {title === undefined ? null : (
          <p className="cq-body font-medium text-(--cq-text-primary)">
            {title}
          </p>
        )}
      </div>
      {children}
      {actions === undefined ? null : (
        <div className="flex flex-wrap gap-2">{actions}</div>
      )}
    </section>
  );
}

export type QResultBlocksProps = {
  readonly blocks: readonly QTurnObjectBlock[];
  /** Ask Q something about one of these objects, in the same thread. */
  readonly onAsk?: ((question: string) => void) | undefined;
  /** Open what Q composed. Absent on a surface with no viewer. */
  readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
};

export function QResultBlocks({
  blocks,
  onAsk,
  onOpenArtifact,
}: QResultBlocksProps) {
  // Prose, findings, uncertainties and the source count are the answer's
  // own; an evidence identifier never reaches this component at all. What
  // arrives here is the part a person can act on.
  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3" data-q-result-blocks>
      {blocks.map((block, index) => {
        const key = `${block.kind}-${String(index)}`;
        switch (block.kind) {
          case "COMPANY_REFERENCE":
            // No company detail surface exists yet, so the only real
            // action is the one that works: keep asking Q, in this
            // thread. An "Open" button to nowhere would be worse than
            // the absence of one.
            return (
              <QResultCard
                key={key}
                label="Company"
                actions={
                  onAsk === undefined ? undefined : (
                    <button
                      type="button"
                      className={buttonClassName("quiet", "compact")}
                      onClick={() => {
                        onAsk("Tell me more about that company.");
                      }}
                    >
                      Ask Q about it
                    </button>
                  )
                }
              />
            );

          case "INVESTOR_REFERENCE":
            return (
              <QResultCard
                key={key}
                label="Investor"
                actions={
                  onAsk === undefined ? undefined : (
                    <button
                      type="button"
                      className={buttonClassName("quiet", "compact")}
                      onClick={() => {
                        onAsk("Tell me more about that investor.");
                      }}
                    >
                      Ask Q about them
                    </button>
                  )
                }
              />
            );

          case "COMPARISON":
            return (
              <QResultCard key={key} label="Side by side">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr>
                        <th className="cq-label px-0 py-2 pr-4 text-(--cq-text-tertiary)">
                          <span className="sr-only">Attribute</span>
                        </th>
                        {block.subjects.map((subject, column) => (
                          <th
                            key={`${subject.kind}-${String(column)}`}
                            scope="col"
                            className="cq-label px-4 py-2 text-(--cq-text-tertiary)"
                          >
                            {subjectLabel(subject)} {column + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row) => (
                        <tr
                          key={row.label}
                          className="border-t border-(--cq-border-subtle)"
                        >
                          <th
                            scope="row"
                            className="cq-body-sm px-0 py-2 pr-4 font-normal text-(--cq-text-secondary)"
                          >
                            {row.label}
                          </th>
                          {row.values.map((value, column) => (
                            <td
                              key={`${row.label}-${String(column)}`}
                              className="cq-body-sm px-4 py-2 text-(--cq-text-primary)"
                            >
                              {/* An empty cell is how the contract says
                                  "unknown". Never a zero, never a dash
                                  that could be read as one. */}
                              {value === "" ? (
                                <span className="text-(--cq-text-tertiary)">
                                  Not known
                                </span>
                              ) : (
                                value
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </QResultCard>
            );

          case "CLARIFICATION_REQUEST":
            return (
              <QResultCard
                key={key}
                label="Q needs to know"
                title={block.question}
                actions={
                  block.options === undefined ||
                  onAsk === undefined ? undefined : (
                    <>
                      {block.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={buttonClassName("secondary", "compact")}
                          onClick={() => {
                            onAsk(option);
                          }}
                        >
                          {option}
                        </button>
                      ))}
                    </>
                  )
                }
              />
            );

          case "ACTION_PROPOSAL":
            // Shown, never actioned from here. Approval binds to the exact
            // payload and lives on the approval control the conversation
            // already renders; a second Approve button beside it would be
            // a second place to say yes.
            return (
              <QResultCard
                key={key}
                label="Q has prepared something"
                title={block.proposal.summary}
              >
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  Nothing happens until you approve it below.
                </p>
              </QResultCard>
            );

          case "ARTIFACT_REFERENCE": {
            /**
             * Something Q composed (QX-003E).
             *
             * The status is on the card because "prepared" and "still
             * being prepared" are different things to somebody about to
             * send a document to an investor, and an absence would make
             * them guess. There is no download control here even for a
             * deck, which now has one: a card in a conversation offers the
             * way in, and choosing between PowerPoint and PDF belongs
             * beside the slides a person is looking at (QX-004 §7).
             */
            const ready = block.status === "READY";
            return (
              <QResultCard
                key={key}
                label={
                  block.type === "INVESTMENT_BRIEF"
                    ? "Investment brief"
                    : block.type === "PITCH_DECK"
                      ? "Investor deck"
                      : "Document"
                }
                title={block.title}
                actions={
                  <>
                    {ready && onOpenArtifact !== undefined ? (
                      <button
                        type="button"
                        className={buttonClassName("secondary", "compact")}
                        onClick={() => {
                          onOpenArtifact(block.artifactId);
                        }}
                        data-q-artifact-open={block.artifactId}
                      >
                        View
                      </button>
                    ) : null}
                    {ready && onAsk !== undefined ? (
                      <button
                        type="button"
                        className={buttonClassName("quiet", "compact")}
                        onClick={() => {
                          // A normal question in the same thread: the
                          // revision is composed and written by the same
                          // authorised path any other answer takes.
                          onAsk(
                            "Edit this document with me — what would you change first?",
                          );
                        }}
                      >
                        Edit with Q
                      </button>
                    ) : null}
                  </>
                }
              >
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {block.status === "READY"
                    ? "A private draft in your workspace. Nothing has been shared or sent."
                    : block.status === "PREPARING"
                      ? "Q is still preparing this."
                      : "Q couldn't finish preparing this one."}
                </p>
              </QResultCard>
            );
          }

          case "UI_INTENT": {
            const href = intentHref(block.intent);
            // Ignored rather than guessed, exactly as a spoken
            // destination with no route is.
            if (href === null) {
              return null;
            }
            return (
              <QResultCard
                key={key}
                label="Where this lives"
                actions={
                  <Link
                    href={href}
                    className={buttonClassName("secondary", "compact")}
                  >
                    {intentLabel(block.intent)}
                  </Link>
                }
              />
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
}
