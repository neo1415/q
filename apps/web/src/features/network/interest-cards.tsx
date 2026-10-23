"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { IncomingInterestDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Search } from "@capital-q/ui/icons";

import { formatDay } from "@/components/date-format";
import { investorTypeLabel } from "@/features/investors/investor-labels";
import {
  LogoTile,
  MatchWord,
  MATCH_WORDS,
  type MatchState,
} from "@/features/investors/match-marks";
import {
  DIMENSION_WORDS,
  MATCH_DIMENSIONS,
  type MatchDimension,
} from "@/features/investors/published-focus";
import {
  tabClass,
  TAB_STRIP_CLASS,
} from "@/features/relationships/hub-navigation";
import {
  CrmToastProvider,
  ProgressButton,
  QLine,
  crmButton,
  useCrmToast,
} from "@/features/relationships/crm-kit";
import { TabCount } from "@/features/relationships/record-parts";
import { useT } from "@/features/i18n/language";

import {
  answerInterestAction,
  type AnswerActionResult,
} from "./interest-actions";

/**
 * Investor interest in the founder's company (CQ-NET-011; app prototype
 * "interest", option 1, "Cards, answer in place").
 *
 * Each card is an investor organisation that told the company it would
 * like to explore it: who they are, what they publish that they look for,
 * and how that matches the company, then Decline and Accept with the same
 * weight. Accept and Decline are server-confirmed: a card says connected
 * or declined only from the server's answer. No score, no celebration, no
 * reason field on decline. Interest carries no note on Capital Q, and the
 * card says so rather than inventing one.
 */

export type InterestFacts = {
  /** "Actively investing", from their declared profile; null not known. */
  readonly deployment: string | null;
  /** What they publish that they look for, as one sentence; null none. */
  readonly looksFor: string | null;
  /** Stage, sector and geography against the founder's own profile. */
  readonly matches: Readonly<Record<MatchDimension, MatchState>>;
};

export type InterestAnswerPort = (input: {
  readonly interestId: string;
  readonly decision: "ACCEPTED" | "DECLINED";
  readonly idempotencyKey: string;
}) => Promise<AnswerActionResult>;

const NO_FACTS: InterestFacts = {
  deployment: null,
  looksFor: null,
  matches: { STAGE: "unk", SECTOR: "unk", GEOGRAPHY: "unk" },
};

/** "Today", "Yesterday", "3 days ago", then the date. */
export function whenWords(value: string, now: Date = new Date()): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  const day = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${String(days)} days ago`;
  return formatDay(value);
}

type Tab = "WAITING" | "ANSWERED";

export function InterestCards(props: {
  readonly items: readonly IncomingInterestDto[];
  readonly facts: ReadonlyMap<string, InterestFacts>;
  readonly answer?: InterestAnswerPort | undefined;
}) {
  return (
    <CrmToastProvider>
      <Cards {...props} />
    </CrmToastProvider>
  );
}

function Cards({
  items,
  facts,
  answer = answerInterestAction,
}: {
  readonly items: readonly IncomingInterestDto[];
  readonly facts: ReadonlyMap<string, InterestFacts>;
  readonly answer?: InterestAnswerPort | undefined;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("WAITING");
  // Answers recorded this visit: the card stays where it was, answered.
  const [answered, setAnswered] = useState<
    ReadonlyMap<string, IncomingInterestDto>
  >(new Map());
  const current = (item: IncomingInterestDto) =>
    answered.get(item.interestId) ?? item;
  const waiting = items.filter((item) => item.response === "PENDING");
  const done = items.map(current).filter((item) => item.response !== "PENDING");
  const waitingCount = waiting.filter(
    (item) => current(item).response === "PENDING",
  ).length;

  return (
    <div className="flex flex-col gap-3.5" data-interest-cards>
      <nav aria-label={t("Investor interest")} className={TAB_STRIP_CLASS}>
        {(
          [
            ["WAITING", t("Waiting for you"), waitingCount],
            ["ANSWERED", t("Answered"), 0],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? "page" : undefined}
            className={tabClass(tab === key)}
            onClick={() => setTab(key)}
            data-interest-tab={key}
          >
            {label}
            {count > 0 ? <TabCount>{count}</TabCount> : null}
          </button>
        ))}
      </nav>
      <QLine small={t("You can answer later; interest doesn’t expire.")}>
        {t(
          "Accepting connects you and opens messages and your data room as you set it. It isn’t an investment or a promise.",
        )}
      </QLine>
      <div key={tab} className="cq-crm-stagger flex flex-col gap-3">
        {tab === "WAITING" ? (
          waiting.length === 0 ? (
            <Empty
              title={t("Nothing waiting for you")}
              body={t(
                "When an investor expresses interest in your company, it appears here for you to accept or decline.",
              )}
            />
          ) : (
            waiting.map((item) => (
              <InterestCard
                key={item.interestId}
                item={current(item)}
                facts={facts.get(item.investorOrganisationId) ?? NO_FACTS}
                answer={answer}
                onAnswered={(next) =>
                  setAnswered((known) =>
                    new Map(known).set(next.interestId, next),
                  )
                }
              />
            ))
          )
        ) : done.length === 0 ? (
          <Empty
            title={t("Nothing answered yet")}
            body={t(
              "When you accept or decline an investor’s interest, it moves here with your answer.",
            )}
          />
        ) : (
          done.map((item) => (
            <InterestCard
              key={item.interestId}
              item={item}
              facts={facts.get(item.investorOrganisationId) ?? NO_FACTS}
              answer={answer}
              onAnswered={() => undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Empty({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div
      className="cq-crm-swap flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-6 py-10 text-center"
      data-state="empty"
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full bg-(--cq-surface-strong) text-(--cq-text-secondary)"
      >
        <Search size={22} />
      </span>
      <b className="text-base text-(--cq-text-primary)">{title}</b>
      <p className="max-w-[44ch] text-sm text-(--cq-text-secondary)">{body}</p>
    </div>
  );
}

function InterestCard({
  item,
  facts,
  answer,
  onAnswered,
}: {
  readonly item: IncomingInterestDto;
  readonly facts: InterestFacts;
  readonly answer: InterestAnswerPort;
  readonly onAnswered: (next: IncomingInterestDto) => void;
}) {
  const t = useT();
  const toast = useCrmToast();
  const [sending, setSending] = useState<"ACCEPTED" | "DECLINED" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // One key per intended answer, reused across retries of it.
  const key = useRef<string | null>(null);
  const name = item.investorName;
  const type = investorTypeLabel(item.investorType);

  const send = async (decision: "ACCEPTED" | "DECLINED") => {
    key.current ??= `answer:${crypto.randomUUID()}`;
    setSending(decision);
    setRefusal(null);
    let result: AnswerActionResult;
    try {
      result = await answer({
        interestId: item.interestId,
        decision,
        idempotencyKey: key.current,
      });
    } catch {
      result = {
        ok: false,
        message: "Your answer was not recorded. Try again.",
        retryable: true,
      };
    }
    setSending(null);
    if (!result.ok) {
      if (!result.retryable) key.current = null;
      setRefusal(result.message);
      return;
    }
    onAnswered(result.value.interest);
    if (decision === "ACCEPTED") {
      toast(t("Connected. Messages are open; it isn’t an investment."));
    }
  };

  const isAnswered = item.response !== "PENDING";
  return (
    <article
      className={cx(
        "flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) px-5 py-[18px] transition-colors duration-(--cq-motion-base)",
        isAnswered ? "bg-(--cq-surface-subtle)" : "bg-(--cq-surface-raised)",
      )}
      data-interest-id={item.interestId}
      data-response={item.response}
    >
      <div className="flex items-center gap-3">
        <LogoTile
          kind="investor"
          name={name}
          src={item.investorPhotoUrl ?? null}
          investorOrganisationId={item.investorOrganisationId}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/investors/${encodeURIComponent(item.investorOrganisationId)}`}
            className="block text-base font-semibold text-(--cq-text-primary) underline-offset-4 hover:underline"
          >
            {name}
          </Link>
          <span className="text-[13px] text-(--cq-text-secondary)">
            {facts.deployment === null
              ? t(type)
              : `${t(type)}, ${t(facts.deployment).toLowerCase()}`}
          </span>
        </div>
        <span className="cq-caption flex-none text-(--cq-text-tertiary)">
          {t(whenWords(item.expressedAt))}
        </span>
      </div>
      {item.note === null || item.note === undefined ? (
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t("No note with their interest.")}
        </span>
      ) : (
        // Their own words to the founders (decision B): shown as written,
        // never translated or rewritten. Only the two parties see it.
        <blockquote
          className="cq-body-sm border-l-2 border-(--cq-border) pl-3 whitespace-pre-line text-(--cq-text-primary)"
          data-interest-note
        >
          <span className="sr-only">{t("Their note:")} </span>
          {item.note}
        </blockquote>
      )}
      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-(--cq-text-secondary)">
        <span>
          {t("Looks for:")} {facts.looksFor ?? t("not on their profile yet")}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
        {MATCH_DIMENSIONS.map((dimension) => (
          <MatchWord
            key={dimension}
            state={facts.matches[dimension]}
            label={`${t(DIMENSION_WORDS[dimension])}: ${t(
              MATCH_WORDS[facts.matches[dimension]],
            ).toLowerCase()}`}
          />
        ))}
      </div>
      {refusal === null ? null : (
        <p className="cq-body-sm text-(--cq-text-primary)" role="status">
          {refusal}
        </p>
      )}
      {item.response === "DECLINED" ? (
        <span
          className="cq-crm-swap cq-caption text-(--cq-text-tertiary)"
          role="status"
        >
          {t("Declined. They see a polite no, never a reason you didn’t give.")}
        </span>
      ) : item.response === "ACCEPTED" ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            href={`/relationships/investor/${encodeURIComponent(item.investorOrganisationId)}`}
            className={crmButton("quiet")}
          >
            {t("Open in CRM")}
          </Link>
          <ProgressButton
            phase="done"
            idle={t("Accept")}
            done={t("Connected")}
            data-accepted
          />
        </div>
      ) : (
        <div className="flex gap-2 sm:justify-end">
          <button
            type="button"
            className={crmButton("secondary", "max-sm:flex-1")}
            disabled={sending !== null}
            onClick={() => void send("DECLINED")}
            data-decline
          >
            {sending === "DECLINED" ? t("Declining…") : t("Decline")}
          </button>
          <ProgressButton
            phase={sending === "ACCEPTED" ? "pending" : "idle"}
            pendingLabel={t("Accepting…")}
            idle={t("Accept")}
            done={t("Connected")}
            disabled={sending === "DECLINED"}
            onClick={() => void send("ACCEPTED")}
            className="max-sm:flex-1"
            data-accept
          />
        </div>
      )}
    </article>
  );
}
