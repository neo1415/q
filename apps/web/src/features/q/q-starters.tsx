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

/**
 * The empty Q home's starters (client 2026-11-05, "like ChatGPT"): at most
 * three rows under the composer, each a small icon and a line. A row asks
 * Q something or goes somewhere real; nothing here answers or simulates.
 */
export type QStarter = {
  readonly id: string;
  readonly label: string;
  readonly icon: "ask" | "setup" | "verify" | "persona";
} & (
  | { readonly kind: "ASK"; readonly prompt: string }
  | { readonly kind: "GO"; readonly href: string }
);

/** The most a home shows: the composer is the point, not a menu. */
export const MAX_STARTERS = 3;

const ICONS = {
  ask: MessageSquare,
  setup: ListChecks,
  verify: ShieldCheck,
  persona: UserRound,
} as const;

/**
 * Starters first (what genuinely waits on the person), then the surface's
 * suggested questions, to three in all.
 */
export function startersOf(
  given: readonly QStarter[],
  suggestions: readonly string[],
): readonly QStarter[] {
  const asks: QStarter[] = suggestions.map((suggestion) => ({
    id: `ask:${suggestion}`,
    label: suggestion,
    icon: "ask",
    kind: "ASK",
    prompt: suggestion,
  }));
  return [...given, ...asks].slice(0, MAX_STARTERS);
}

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
