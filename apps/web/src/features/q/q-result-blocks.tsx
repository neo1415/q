"use client";

import Link from "next/link";

import type {
  QSubjectRef,
  QUiCompanySection,
  QUiIntent,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { EntityAvatar } from "@/features/entity/entity-avatar";

import { CompanyAvatar } from "../company/company-avatar";
import { destinationPath } from "../voice/destinations";
import { ArtifactCard } from "./artifact-card";
import { CalendarConnectCard } from "./calendar-connect-card";
import { ComparisonCards } from "./comparison-cards";
import { StaticAnswerCards } from "./static-answer-cards";
import { recordPagePath, settingsPath, setupPath } from "./client-actions";
import { roomCardHref } from "./room/room-card-view";
import type { QTurnObjectBlock } from "./conversation";
import { useWire } from "./use-wire";
import { wireNow } from "./wire";

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
const INTENT_ROUTES: Readonly<
  Record<
    Exclude<
      QUiIntent["kind"],
      | "NAVIGATE"
      | "SET_THEME"
      | "RELOAD_PAGE"
      | "OPEN_WEBSITE"
      | "SET_Q_MOTION"
      | "SET_VOICE"
      | "SIGN_OUT"
      | "OPEN_RECORD_PAGE"
      | "OPEN_SETUP"
      | "SET_DISCOVER_FILTERS"
      | "SCREEN_ACT"
      | "OPEN_COMPANY"
      | "FOCUS_SECTION"
      | "OPEN_SETTINGS"
      | "SHOW_IN_Q_ROOM"
      | "SHOW_CALENDAR_CONNECT"
      | "DOCUMENT_ACT"
    >,
    string | null
  >
> = {
  SHOW_COMPARISON: null,
  SHOW_EVIDENCE: null,
};

/** The company page's tab for a section, or null for its default view. */
const COMPANY_SECTION_TABS: Readonly<Record<QUiCompanySection, string | null>> =
  {
    OVERVIEW: "overview",
    TEAM: "team",
    PITCH: "elevator",
    FINANCIALS: null,
    CAPITAL_OBJECTIVE: null,
    EVIDENCE: null,
    DOCUMENTS: "dataroom",
  };

export function intentHref(intent: QUiIntent): string | null {
  // A named surface, through the same route map spoken navigation uses.
  if (intent.kind === "NAVIGATE") {
    return destinationPath(intent.destination);
  }
  // Client actions happen as the answer arrives (client-actions.ts); a
  // website also gets its own link card below, never an in-app route.
  if (
    intent.kind === "SET_THEME" ||
    intent.kind === "RELOAD_PAGE" ||
    intent.kind === "OPEN_WEBSITE" ||
    intent.kind === "SET_Q_MOTION" ||
    intent.kind === "SET_VOICE" ||
    intent.kind === "SIGN_OUT" ||
    // Done on the page as the answer arrives; there is nowhere to link.
    intent.kind === "SCREEN_ACT" ||
    // Q room R5: its own card below, not a link.
    intent.kind === "SHOW_CALENDAR_CONNECT" ||
    intent.kind === "DOCUMENT_ACT"
  ) {
    return null;
  }
  if (intent.kind === "OPEN_RECORD_PAGE") {
    return recordPagePath(intent.page, intent.id, intent.companyId);
  }
  // The company page exists now (CQ-WEB-022) and authorises the read as
  // the person; an OPEN_COMPANY card that went nowhere was R0 (live
  // 2026-10-06). A section opens the page's matching tab where it has one.
  if (intent.kind === "OPEN_COMPANY") {
    return recordPagePath("COMPANY", intent.companyId);
  }
  if (intent.kind === "FOCUS_SECTION") {
    const tab = COMPANY_SECTION_TABS[intent.section];
    const page = recordPagePath("COMPANY", intent.companyId);
    return tab === null ? page : `${page}?tab=${tab}`;
  }
  if (intent.kind === "OPEN_SETUP") {
    return setupPath(intent.journey);
  }
  if (intent.kind === "OPEN_SETTINGS") {
    return settingsPath(intent.section);
  }
  // Q room R4: the card is on the Q page; its link is the record's page.
  if (intent.kind === "SHOW_IN_Q_ROOM") {
    return intent.object === "SOURCES" ? null : roomCardHref(intent);
  }
  // The filters are applied as the answer arrives; the card opens the feed.
  if (intent.kind === "SET_DISCOVER_FILTERS") {
    return "/discover";
  }
  const route = INTENT_ROUTES[intent.kind];
  if (route === null) {
    return null;
  }
  switch (intent.kind) {
    case "SHOW_COMPARISON":
      return `${route}?compare=${intent.companyIds.map(encodeURIComponent).join(",")}`;
    case "SHOW_EVIDENCE":
      return route;
  }
}

/**
 * A website intent's URL, re-validated here: http(s) only, or null. W7:
 * against the wire's contracts; null (no link yet) until they are in.
 */
function safeWebsite(intent: QUiIntent): string | null {
  if (intent.kind !== "OPEN_WEBSITE") return null;
  const schema = wireNow()?.QWebsiteUrlSchema;
  if (schema === undefined) return null;
  const url = schema.safeParse(intent.url);
  return url.success ? url.data : null;
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
    case "NAVIGATE":
      return DESTINATION_LABELS[intent.destination];
    case "SET_THEME":
      return "Appearance";
    case "RELOAD_PAGE":
      return "Reload";
    case "OPEN_WEBSITE":
      return "Open the website";
    case "SET_Q_MOTION":
      return "Q motion";
    case "SET_VOICE":
      return "Q's voice";
    case "SIGN_OUT":
      return "Sign out";
    case "OPEN_RECORD_PAGE":
      return intent.page === "DOCUMENT" || intent.page === "DATA_ROOM_DOCUMENT"
        ? "Open the document"
        : intent.page === "COMPANY_PITCH"
          ? "Watch the pitch"
          : intent.page === "COMPANY"
            ? "Open the company"
            : intent.page === "INVESTOR"
              ? "Open the investor"
              : intent.page === "INVESTOR_REHEARSAL" ||
                  intent.page === "COMPANY_REHEARSAL"
                ? "Rehearse the meeting"
                : intent.page.endsWith("_MESSAGES")
                  ? "Open the chat"
                  : (RECORD_PAGE_LABELS[intent.page] ??
                    "Open the relationship");
    case "SCREEN_ACT":
      return "On this page";
    case "OPEN_SETUP":
      return intent.journey === "investor"
        ? "Continue your mandate"
        : "Continue setup";
    case "SET_DISCOVER_FILTERS":
      return "Open Discover";
    case "OPEN_SETTINGS":
      return "Open Settings";
    case "SHOW_IN_Q_ROOM":
      return `Open ${intent.title}`;
    case "SHOW_CALENDAR_CONNECT":
      return "Connect Google Calendar";
    case "DOCUMENT_ACT":
      return "The open document";
  }
}

/** Q room R2: the deep links' own words. */
const RECORD_PAGE_LABELS: Readonly<Partial<Record<string, string>>> = {
  COMPANY_ELEVATOR: "Open the elevator pitch",
  COMPANY_DATA_ROOM: "Open the data room",
  COMPANY_DECK: "Open the pitch deck",
  COMPANY_TEAM: "Open the team",
  WORK_ITEM: "Open the work",
  CAPITAL_ROUND: "Open the round",
  GATEQ_APPLICATION: "Open the application",
};

const DESTINATION_LABELS: Readonly<
  Record<Extract<QUiIntent, { kind: "NAVIGATE" }>["destination"], string>
> = {
  HOME: "Go to Home",
  PROFILE: "Open your profile",
  CAPITAL: "Open Capital",
  DISCOVER: "Open Discover",
  COMPANY_VISIBILITY: "Open visibility settings",
  RELATIONSHIPS: "Open Relationships",
  SETTINGS: "Open Settings",
  VERIFICATION: "Open Verification",
  PITCH: "Open Pitch & media",
  COMPANY_INTEREST: "Open investor interest",
  SAVED: "Open Saved",
  PASSED: "Open Passed",
  INVESTORS: "Open Investors",
  SEARCH: "Open Search",
  GATEWAY: "Open your gateway",
  MEMORY: "Open what Q remembers",
  USAGE: "See what Q used for you",
  NEW_PITCH: "Add a pitch video",
  REHEARSALS: "Open Rehearsals",
  DOCUMENTS: "Open Documents",
  DAILY: "Open The Q Daily",
  RESULTS: "Open Results",
  YOUR_COMPANIES: "Open Your companies",
  WORK: "Open Work",
  EXPLORE: "Open Explore",
  PEOPLE_SEARCH: "Open Search",
  WORK_NEEDS: "Open Needs you",
  WORK_PROGRESS: "Open In progress",
  WORK_DONE: "Open Done",
  WORK_TEAM: "Open Q's team",
  WORK_COST: "Open Cost",
  GATEQ_INBOX: "Open your GateQ inbox",
  GATEQ_FIND: "Open GateQ Find",
  GATEQ_CLAIM: "Open GateQ Claim",
  GATEQ_APPLICATIONS: "Open your applications",
  SAVED_COMPARE: "Open Compare",
  REVIEWS: "Open Human review",
  TOP_INVESTORS: "Open your top investors",
};

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
  // W7: drawn again once the wire's contracts are in (safeWebsite).
  useWire();
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
            // The company page authorises the read as this person; a
            // company they may not see is its plain not-found.
            return (
              <QResultCard
                key={key}
                label="Company"
                actions={
                  <>
                    <Link
                      href={recordPagePath("COMPANY", block.companyId)}
                      className={buttonClassName("secondary", "compact")}
                    >
                      Open the company
                    </Link>
                    {onAsk === undefined ? null : (
                      <button
                        type="button"
                        className={buttonClassName("quiet", "compact")}
                        onClick={() => {
                          onAsk("Tell me more about that company.");
                        }}
                      >
                        Ask Q about it
                      </button>
                    )}
                  </>
                }
              >
                {/* The company's picture through its gated photo route;
                    the block names no one, so the frame stays unlabelled. */}
                <CompanyAvatar companyId={block.companyId} size={40} />
              </QResultCard>
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
              >
                {/* The investor's logo through its gated photo route, which
                    answers only where this reader may see their name. */}
                <EntityAvatar
                  kind="investor"
                  name="Investor"
                  investorOrganisationId={block.investorOrganisationId}
                  size={40}
                  decorative
                />
              </QResultCard>
            );

          case "COMPARISON_CARDS":
            return <ComparisonCards key={key} block={block} onAsk={onAsk} />;

          case "ANSWER_CARDS":
            // In the thread and on the Board: the overview, every card
            // with its first reason; tapping one opens it.
            return <StaticAnswerCards key={key} block={block} onAsk={onAsk} />;

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

          case "ARTIFACT_REFERENCE":
            // Something Q composed (QX-003E, R36): one card language for
            // the answer and the Board. Older versions stay in the viewer.
            return (
              <ArtifactCard
                key={key}
                block={block}
                onOpen={onOpenArtifact}
                onAsk={onAsk}
              />
            );

          case "UI_INTENT": {
            // Q room R5: suggested times and the connect card, in the room.
            if (block.intent.kind === "SHOW_CALENDAR_CONNECT") {
              return <CalendarConnectCard key={key} intent={block.intent} />;
            }
            // Their own website, opened in a new tab as the answer arrived;
            // the link stays for a browser that blocked the automatic open.
            const website = safeWebsite(block.intent);
            if (website !== null) {
              return (
                <QResultCard
                  key={key}
                  label="Your website"
                  actions={
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClassName("secondary", "compact")}
                    >
                      Open {new URL(website).hostname}
                    </a>
                  }
                />
              );
            }
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
