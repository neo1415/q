"use client";

import Link from "next/link";

import type { QAttentionItem, QAttentionReport } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { unreadWords } from "@/features/briefing/attention";

/**
 * "Anything that needs my attention", as Q answered it (RECOVERY-2026-10
 * G-R4; Scenario F). One line per thing waiting, each opening where it is
 * acted on, and the sources Q could not read said as such: unknown is
 * never shown as "nothing" (SPEC §4.4). Nothing is decided from here; the
 * decisions stay on their own cards.
 */

/** Where an item is acted on, from the record it names. */
export function attentionItemHref(item: QAttentionItem): string {
  const entity = item.entity;
  if (entity !== undefined) {
    switch (entity.kind) {
      case "COMPANY":
        return `/company/${encodeURIComponent(entity.id)}`;
      case "INVESTOR_ORGANISATION":
        return `/investors/${encodeURIComponent(entity.id)}`;
      case "DOCUMENT":
        return "/documents";
      case "APPROVAL":
      case "JOB":
        return "/work";
      case "RELATIONSHIP":
      case "MEETING":
        return "/relationships";
    }
  }
  switch (item.source) {
    case "DOCUMENT_REQUEST":
      return "/documents";
    case "NEW_MATCHES":
      return "/discover";
    case "UNANSWERED_MESSAGE":
    case "INTEREST_REQUEST":
    case "MEETING":
      return "/relationships";
    case "APPROVAL":
    case "HELD_DRAFT":
    case "AGENT_BLOCKED":
    case "REMINDER":
    case "NOTICE":
      return "/work";
  }
}

export function AttentionBody({
  report,
}: {
  readonly report: QAttentionReport;
}) {
  const unread = unreadWords(report.unread);
  return (
    <div
      className="flex flex-col gap-2"
      data-q-attention
      data-q-attention-unread={
        report.unread.length === 0 ? undefined : report.unread.join(",")
      }
    >
      {report.items.length === 0 ? (
        <p className="cq-body-sm m-0 text-(--cq-text-secondary)">
          {unread === null
            ? "Nothing is waiting on you."
            : "Nothing is waiting in what I could check."}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {report.items.map((item) => (
            <li
              key={item.key}
              className="flex min-h-11 items-center gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-1.5"
              data-q-attention-item={item.source}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {item.title}
                </span>
                {item.note === undefined ? null : (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {item.note}
                  </span>
                )}
              </span>
              <Link
                href={attentionItemHref(item)}
                className={buttonClassName("quiet", "compact")}
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
      {unread === null ? null : (
        <p
          className="cq-caption m-0 text-(--cq-text-secondary)"
          data-q-attention-unread-line
        >
          {unread}
        </p>
      )}
    </div>
  );
}
