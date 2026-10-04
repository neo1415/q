"use client";

import { useId, useState } from "react";

import type { DocumentDownloadAudience } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Select } from "@capital-q/ui/select";
import { InlineNotice } from "@capital-q/ui/states";

import { setDeckAudienceAction } from "./deck-sharing-actions";

/**
 * Who can download a pitch deck (ADR 0041; founder decision 2026-10-02):
 * one choice, in the pitch's own words. "Only my organisation" is the
 * default; "Investors who can find us" lets every investor who can watch
 * the company's pitch download the deck from its profile. The screen sends
 * the version it saw, so a stale page never overwrites a newer choice.
 * Anything sent in a conversation stays shared there either way.
 */

export type DeckRow = {
  readonly documentId: string;
  readonly title: string;
  readonly downloadAudience: DocumentDownloadAudience;
  readonly version: number;
};

export const DECK_AUDIENCE_OPTIONS: readonly {
  readonly value: DocumentDownloadAudience;
  readonly label: string;
}[] = [
  { value: "ORGANISATION", label: "Only my organisation" },
  { value: "INVESTORS", label: "Investors who can find us" },
];

export function deckAudienceDescription(
  audience: DocumentDownloadAudience,
): string {
  return audience === "INVESTORS" ? "From your profile." : "Private.";
}

function DeckChoice({ deck }: { readonly deck: DeckRow }) {
  const id = useId();
  const [record, setRecord] = useState(deck);
  const [audience, setAudience] = useState(deck.downloadAudience);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    readonly tone: "info" | "warning";
    readonly text: string;
  } | null>(null);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    const result = await setDeckAudienceAction({
      documentId: record.documentId,
      audience,
      expectedVersion: record.version,
    });
    setSaving(false);
    if (!result.ok) {
      setNotice({ tone: "warning", text: result.message });
      return;
    }
    setRecord({
      ...record,
      downloadAudience: result.value.downloadAudience,
      version: result.value.version,
    });
    setNotice({ tone: "info", text: "Saved." });
  };

  return (
    <li
      className="flex flex-col gap-3 py-4"
      data-deck-sharing={deck.documentId}
    >
      <p className="cq-body font-medium text-(--cq-text-primary)">
        {deck.title}
      </p>
      <Select
        id={`${id}-audience`}
        label="Who can download it"
        description={deckAudienceDescription(audience)}
        options={DECK_AUDIENCE_OPTIONS}
        value={audience}
        onChange={(event) =>
          setAudience(
            event.target.value === "INVESTORS" ? "INVESTORS" : "ORGANISATION",
          )
        }
      />
      {notice === null ? null : (
        <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>
      )}
      <div>
        <Button
          variant="secondary"
          disabled={audience === record.downloadAudience || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </li>
  );
}

export function DeckSharing({ decks }: { readonly decks: readonly DeckRow[] }) {
  if (decks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="deck-sharing">
      <h2 id="deck-sharing" className="cq-title-sm text-(--cq-text-primary)">
        Pitch deck
      </h2>
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
        {decks.map((deck) => (
          <DeckChoice key={deck.documentId} deck={deck} />
        ))}
      </ul>
    </section>
  );
}
