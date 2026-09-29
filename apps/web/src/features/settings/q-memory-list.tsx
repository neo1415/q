"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { QMemoryItemDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { forgetMemoryAction } from "./memory-actions";

/**
 * What Q remembers, grouped by kind, each with Forget (ADR 0012). Q uses
 * these in every conversation without being reminded; one that is wrong
 * (a misheard name, say) is forgotten here and Q stops using it at once.
 */
const KIND_WORDS: Readonly<Record<string, string>> = {
  preference: "How you like to work",
  correction: "Corrections you made",
  pronunciation: "Names and how they're said",
  fact: "Things you told Q",
};

export function QMemoryList({
  items,
}: {
  readonly items: readonly QMemoryItemDto[];
}) {
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = items.filter((item) => !gone.has(item.memoryItemId));

  if (shown.length === 0) {
    return (
      <p className="cq-body text-(--cq-text-secondary)" data-state="empty">
        Q hasn&apos;t remembered anything about you yet. Tell it how you like to
        work, or correct it, and it keeps that for every conversation.
      </p>
    );
  }

  const kinds = [
    ...new Set([...Object.keys(KIND_WORDS), ...shown.map((item) => item.kind)]),
  ].filter((kind) => shown.some((item) => item.kind === kind));

  return (
    <div className="flex flex-col gap-8">
      {failed === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {failed}
        </p>
      )}
      {kinds.map((kind) => (
        <section key={kind} aria-labelledby={`memory-${kind}`}>
          <h2
            id={`memory-${kind}`}
            className="cq-title-sm mb-3 text-(--cq-text-primary)"
          >
            {KIND_WORDS[kind] ?? kind}
          </h2>
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {shown
              .filter((item) => item.kind === kind)
              .map((item) => (
                <li
                  key={item.memoryItemId}
                  className="flex items-start gap-4 py-3"
                  data-memory-item={item.memoryItemId}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="cq-body text-(--cq-text-primary)">
                      {item.content}
                    </p>
                    {item.quote === null ? null : (
                      <p className="cq-caption text-(--cq-text-tertiary)">
                        From what you said: &ldquo;{item.quote}&rdquo;
                      </p>
                    )}
                  </div>
                  <Button
                    variant="quiet"
                    disabled={pending}
                    onClick={() => {
                      setFailed(null);
                      startTransition(async () => {
                        const result = await forgetMemoryAction(
                          item.memoryItemId,
                        );
                        if (!result.ok) {
                          setFailed(
                            "That wasn't forgotten. Try again in a moment.",
                          );
                          return;
                        }
                        setGone((current) =>
                          new Set(current).add(item.memoryItemId),
                        );
                        router.refresh();
                      });
                    }}
                    aria-label={`Forget: ${item.content}`}
                  >
                    Forget
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
