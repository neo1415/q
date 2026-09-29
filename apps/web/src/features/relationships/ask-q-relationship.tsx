"use client";

import { useState } from "react";

import { Button } from "@capital-q/ui/button";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { QAperture } from "@/features/q-aperture/q-aperture";

/**
 * Ask Q about this relationship (founder design 2026-09-28): three
 * starting questions and a line of your own, each opening Q with it.
 * Q answers under the relationship's own scope (the page's subject);
 * nothing here drafts or sends anything itself.
 */
export function AskQRelationshipPanel({
  counterpart,
}: {
  readonly counterpart: string;
}) {
  const { askAbout } = useGlobalQ();
  const [draft, setDraft] = useState("");
  const suggestions = [
    {
      label: "Summarise this conversation",
      prompt: `Summarise my conversation with ${counterpart}.`,
    },
    {
      label: "What are good next steps?",
      prompt: `What are good next steps with ${counterpart}?`,
    },
    {
      label: "Draft a follow-up message",
      prompt: `Draft a follow-up message to ${counterpart}.`,
    },
  ];
  return (
    <section
      aria-label="Ask Q about this relationship"
      className="flex flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-4"
    >
      <h2 className="cq-body flex items-center gap-2 font-semibold text-(--cq-text-primary)">
        <QAperture state="IDLE" size="chrome" />
        Ask Q about this relationship
      </h2>
      <ul className="flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.label}>
            <button
              type="button"
              onClick={() => askAbout(suggestion.prompt)}
              className="cq-body-sm flex min-h-11 w-full items-center rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) px-3 text-left text-(--cq-text-primary) hover:bg-(--cq-surface-raised) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            >
              {suggestion.label}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const question = draft.trim();
          if (question.length === 0) return;
          askAbout(question);
          setDraft("");
        }}
      >
        <label className="sr-only" htmlFor="ask-q-relationship">
          Ask Q anything about {counterpart}
        </label>
        <input
          id="ask-q-relationship"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask anything…"
          className="cq-body-sm min-h-11 min-w-0 flex-1 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-3 text-(--cq-text-primary)"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={draft.trim().length === 0}
        >
          Ask
        </Button>
      </form>
    </section>
  );
}
