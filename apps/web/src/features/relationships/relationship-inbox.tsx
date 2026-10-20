import "server-only";

import Link from "next/link";

import { listRelationshipBriefs } from "@capital-q/api-client";
import {
  isMatchedRelationshipState,
  type ChatThreadDto,
  type RelationshipBrief,
  type RelationshipStatusDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { ArrowLeft, ICON_SIZE, Lock, MessageSquare } from "@capital-q/ui/icons";

import { PageContainer } from "@/components/app-shell/page-container";
import { formatStamp } from "@/components/date-format";
import { RelationshipChat } from "@/features/chat/relationship-chat";
import { EntityAvatar } from "@/features/entity/entity-avatar";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { serverTNow } from "@/features/i18n/server-now";

import { HubHeader } from "./hub-header";
import { ownRelationships, unreadByRelationship } from "./relationship-data";
import type { CounterpartProfile } from "./relationship-page-data";
import { inboxRows, type InboxRow } from "./inbox-rows";
import { TILE } from "./record-parts";

/**
 * Messages as the CRM prototype's inbox split (messages option 3, owner
 * 2026-10-20): every conversation this side has, newest first, with the
 * one open beside it. Unread counts in the accent; a lock where messaging
 * has not opened yet, and that pane says why it is empty and when it
 * opens. On a phone the list and the thread are two screens. Every row is
 * the API's own answer for this person (the per-party fold, the brief's
 * latest message, the unread counts); nothing is sent from here except by
 * the person, from the thread's own composer.
 */

/** The side's conversations, read as the person; undefined when unreadable. */
async function loadRows(): Promise<{
  readonly side: "INVESTOR" | "COMPANY" | "NONE";
  readonly rows: readonly InboxRow[] | undefined;
}> {
  const context = await resolveOwnContext();
  const side =
    context.kind === "INVESTOR"
      ? "INVESTOR"
      : context.kind === "FOUNDER"
        ? "COMPANY"
        : "NONE";
  const items = await ownRelationships(context);
  if (items === undefined) return { side, rows: undefined };
  const session = await apiSession();
  const page = items.slice(0, 40);
  const [briefs, unread] = await Promise.all([
    session === null || page.length === 0
      ? new Map<string, RelationshipBrief>()
      : listRelationshipBriefs(session, {
          companyId: context.kind === "FOUNDER" ? context.companyId : undefined,
          relationshipIds: page.map((item) => item.relationshipId),
        })
          .then(
            (list) =>
              new Map(list.items.map((brief) => [brief.relationshipId, brief])),
          )
          .catch(() => new Map<string, RelationshipBrief>()),
    unreadByRelationship(),
  ]);
  return { side, rows: inboxRows(items, briefs, unread) };
}

export async function RelationshipInbox({
  counterpart,
  relationship,
  profile,
  thread,
  basePath,
  stateLine,
  showList,
}: {
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto;
  readonly profile: CounterpartProfile;
  readonly thread: ChatThreadDto | null;
  readonly basePath: string;
  /** "In diligence, call tomorrow 14:00": where it stands, in words. */
  readonly stateLine: string;
  /** A phone shows the list (true) or the thread (false). */
  readonly showList: boolean;
}) {
  const t = serverTNow();
  const { side, rows } = await loadRows();
  const matched = isMatchedRelationshipState(relationship.state);
  const listHref = `${basePath}/messages?inbox=1`;

  const avatar = (row: {
    readonly name: string;
    readonly photoUrl: string | null;
    readonly companyId?: string | undefined;
    readonly investorOrganisationId?: string | undefined;
  }) => (
    <EntityAvatar
      kind={row.companyId === undefined ? "investor" : "company"}
      name={row.name}
      src={
        row.investorOrganisationId === undefined
          ? row.photoUrl
          : (row.photoUrl ?? undefined)
      }
      companyId={row.companyId}
      investorOrganisationId={row.investorOrganisationId}
      size={28}
      decorative
      className={cx("rounded-(--cq-radius-md)! border-0!", TILE)}
    />
  );

  const list = (
    <nav
      aria-label={t("Conversations")}
      className={cx(
        "min-h-0 overflow-y-auto bg-(--cq-surface) lg:border-e lg:border-(--cq-border-subtle)",
        "max-lg:rounded-(--cq-radius-lg) max-lg:border max-lg:border-(--cq-border-subtle)",
        showList ? undefined : "max-lg:hidden",
      )}
      data-inbox-list
    >
      {rows === undefined ? (
        <p className="cq-body-sm p-4 text-(--cq-text-secondary)">
          {t("Your conversations couldn't be read just now.")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
          {rows.map((row) => {
            const on = row.relationshipId === relationship.relationshipId;
            return (
              <li key={row.relationshipId}>
                <Link
                  href={row.href}
                  aria-current={on ? "page" : undefined}
                  className={cx(
                    "relative grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-3 transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
                    on
                      ? "lg:bg-(--cq-surface-raised) lg:before:absolute lg:before:inset-y-2.5 lg:before:start-0 lg:before:w-[3px] lg:before:rounded-e-[3px] lg:before:bg-(--cq-accent)"
                      : "hover:bg-(--cq-surface-subtle)",
                  )}
                  data-inbox-row={row.matched ? "open" : "locked"}
                >
                  {avatar(row)}
                  <span className="min-w-0">
                    <span
                      className={cx(
                        "cq-body-sm block truncate text-(--cq-text-primary)",
                        row.unread > 0 ? "font-bold" : "font-medium",
                      )}
                    >
                      {row.name}
                    </span>
                    <span className="cq-caption flex items-center gap-1 truncate text-(--cq-text-secondary)">
                      {row.matched ? null : (
                        <Lock
                          size={ICON_SIZE.compact}
                          aria-hidden="true"
                          className="flex-none"
                        />
                      )}
                      <span className="truncate">{t(row.preview)}</span>
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span
                      className="cq-caption cq-numeric text-(--cq-text-tertiary)"
                      suppressHydrationWarning
                    >
                      {row.matched ? formatStamp(row.at) : ""}
                    </span>
                    {row.unread > 0 ? (
                      <span
                        className="cq-caption cq-numeric grid h-5 min-w-5 place-items-center rounded-full bg-(--cq-accent) px-1 text-[11px] font-semibold text-(--cq-text-inverse)"
                        aria-label={t(`${String(row.unread)} unread`)}
                      >
                        {row.unread}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );

  const back = (
    <Link
      href={listHref}
      aria-label={t("All conversations")}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) lg:hidden"
    >
      <ArrowLeft size={ICON_SIZE.regular} aria-hidden="true" />
    </Link>
  );
  const who = (
    <>
      {back}
      {avatar({
        name: counterpart,
        photoUrl: profile.photoUrl,
        companyId: profile.companyId,
        investorOrganisationId: profile.investorOrganisationId,
      })}
      <span className="flex min-w-0 flex-col">
        <b className="cq-body-sm truncate font-semibold text-(--cq-text-primary)">
          {counterpart}
        </b>
        <span className="cq-caption truncate text-(--cq-text-tertiary)">
          {t(stateLine)}
        </span>
      </span>
    </>
  );

  const pane = (
    <div
      className={cx(
        "flex min-h-0 min-w-0 flex-col bg-(--cq-canvas)",
        showList ? "max-lg:hidden" : "max-lg:h-full",
      )}
      data-inbox-pane={matched ? "thread" : "locked"}
    >
      {matched ? (
        <RelationshipChat
          relationshipId={relationship.relationshipId}
          counterpart={counterpart}
          initial={thread}
          tall
          headerStart={who}
          headerEnd={
            <Link
              href={basePath}
              className={buttonClassName("quiet", "compact")}
            >
              {t("Open record")}
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex items-center gap-3 border-b border-(--cq-border-subtle) px-3 py-2.5">
            {who}
          </div>
          <div className="grid flex-1 place-items-center p-6">
            <div
              className="cq-swap flex max-w-md flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface) px-6 py-10 text-center"
              data-messages-locked
            >
              <span className="grid size-12 place-items-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
                <MessageSquare size={ICON_SIZE.prominent} aria-hidden="true" />
              </span>
              <b className="cq-body font-semibold text-(--cq-text-primary)">
                {t("Messages open once both sides agree to connect")}
              </b>
              <p className="cq-body-sm max-w-[44ch] text-(--cq-text-secondary)">
                {relationship.state === "INTEREST_EXPRESSED"
                  ? side === "INVESTOR"
                    ? t(
                        `You expressed interest on ${formatStamp(relationship.stateSince)}. When ${counterpart} accepts, you can write to each other here.`,
                      )
                    : t(
                        `${counterpart} expressed interest. When you accept, you can write to each other here.`,
                      )
                  : t(
                      `When you and ${counterpart} are connected, you can write to each other here.`,
                    )}
              </p>
              <Link href={basePath} className={buttonClassName("secondary")}>
                {t("Open the relationship")}
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <PageContainer
      className={cx(
        "flex flex-col gap-5",
        showList ? undefined : "max-lg:px-0 max-lg:pt-0 max-lg:pb-0",
      )}
    >
      <div className={showList ? "contents" : "contents max-lg:hidden"}>
        {side === "NONE" ? null : <HubHeader side={side} view="pipeline" />}
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
            {t("Messages")}
          </h2>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t("Every conversation, newest first")}
          </span>
        </div>
      </div>
      <div
        className={cx(
          "grid min-h-0 lg:h-[700px] lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden lg:rounded-(--cq-radius-lg) lg:border lg:border-(--cq-border-subtle) lg:bg-(--cq-surface-raised)",
          showList
            ? undefined
            : "max-lg:h-[calc(100dvh-3.5rem-var(--cq-safe-bottom))]",
        )}
        {...(showList ? {} : { "data-chat-thread": "" })}
      >
        {list}
        {pane}
      </div>
    </PageContainer>
  );
}
