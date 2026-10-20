import { buttonClassName } from "@capital-q/ui/button";

import type { QTurnObjectBlock } from "./conversation";

/**
 * A comparison as cards (founder design 2026-09-28): two to four named
 * things side by side, each with a monogram, its name, a line under it and
 * the few points that matter for what was asked. The cards are laid out in
 * the order Q wrote them and carry no order, score or badge: choosing
 * between them stays the person's (the charter forbids rankings). One
 * column on a phone, then as many as fit.
 */

type CardsBlock = Extract<QTurnObjectBlock, { kind: "COMPARISON_CARDS" }>;

/** Up to two letters from the name's words; decorative, never the name. */
export function monogram(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters =
    words.length >= 2
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

const COLUMNS: Readonly<Record<number, string>> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
};

export function ComparisonCards({
  block,
  onAsk,
}: {
  readonly block: CardsBlock;
  readonly onAsk?: ((question: string) => void) | undefined;
}) {
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={block.title ?? "Side by side"}
      data-q-comparison-cards
    >
      {block.title === null ? null : (
        <h3 className="cq-body font-medium text-(--cq-text-primary)">
          {block.title}
        </h3>
      )}
      <ul
        className={`grid grid-cols-1 gap-3 ${COLUMNS[block.items.length] ?? COLUMNS[4] ?? ""}`}
      >
        {block.items.map((item, index) => (
          <li
            key={`${item.name}-${String(index)}`}
            className="flex min-w-0 flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
            data-q-comparison-card
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-(--cq-border-subtle) bg-(--cq-surface) text-sm font-semibold text-(--cq-text-secondary)"
              >
                {monogram(item.name)}
              </span>
              <div className="flex min-w-0 flex-col">
                <p className="cq-body truncate font-medium text-(--cq-text-primary)">
                  {item.name}
                </p>
                {item.subtitle === null ? null : (
                  <p className="cq-caption truncate text-(--cq-text-tertiary)">
                    {item.subtitle}
                  </p>
                )}
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {item.points.map((point, at) => (
                <li
                  key={`${String(at)}-${point}`}
                  className="cq-body-sm flex gap-2 text-(--cq-text-secondary)"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-(--cq-text-tertiary)"
                  />
                  <span className="min-w-0 break-words">{point}</span>
                </li>
              ))}
            </ul>
            {onAsk === undefined ? null : (
              <button
                type="button"
                className={`${buttonClassName("quiet", "compact")} mt-auto self-start`}
                onClick={() => {
                  onAsk(`Tell me more about ${item.name}.`);
                }}
              >
                Ask Q about {item.name}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
