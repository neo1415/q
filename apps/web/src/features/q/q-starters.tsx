"use client";

import Link from "next/link";

import {
  ICON_SIZE,
  ICON_STROKE,
  ListChecks,
  MessageSquare,
  ShieldCheck,
  UserRound,
} from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import type { QStarter } from "./q-starter-list";

// The starters' data lives in q-starter-list.ts (no React, no icons), so the
// Q pane's server placeholder can use it without this module.
export { MAX_STARTERS, startersOf, type QStarter } from "./q-starter-list";

const ICONS = {
  ask: MessageSquare,
  setup: ListChecks,
  verify: ShieldCheck,
  persona: UserRound,
} as const;

export function QStarters({
  starters,
  onAsk,
}: {
  readonly starters: readonly QStarter[];
  readonly onAsk: (prompt: string) => void;
}) {
  const t = useT();
  if (starters.length === 0) return null;
  return (
    <ul
      aria-label={t("Suggested questions")}
      className="flex w-full flex-col gap-0.5"
      data-q-suggestions
    >
      {starters.map((starter) => {
        const Icon = ICONS[starter.icon];
        const body = (
          <>
            <Icon
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
              className="shrink-0 text-(--cq-text-tertiary)"
            />
            <span className="min-w-0 flex-1 truncate">{t(starter.label)}</span>
          </>
        );
        return (
          <li key={starter.id} data-q-starter={starter.icon}>
            {starter.kind === "GO" ? (
              <Link href={starter.href} className="cq-q-starter">
                {body}
              </Link>
            ) : (
              <button
                type="button"
                className="cq-q-starter"
                onClick={() => onAsk(starter.prompt)}
              >
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
