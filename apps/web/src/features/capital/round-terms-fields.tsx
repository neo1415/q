"use client";

import { Input } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";

import { PRO_RATA_WORDS } from "./round-words";
import type { TermsDraft } from "./round-terms";

export type LeadOption = {
  readonly relationshipId: string;
  readonly name: string;
};
export type RoundOption = { readonly id: string; readonly name: string };

/**
 * A round's terms, every one optional (plan P8): leaving a field empty keeps
 * it unknown. Amounts are in the round's currency, shown beside each label
 * so a currency mismatch can't be typed. The lead is one of the company's
 * investor relationships, or a name for a lead who isn't on Capital Q.
 */
export function RoundTermsFields({
  id,
  draft,
  onChange,
  currency,
  leads,
  rounds,
  past = false,
}: {
  readonly id: string;
  readonly draft: TermsDraft;
  readonly onChange: (next: TermsDraft) => void;
  readonly currency: string;
  readonly leads: readonly LeadOption[];
  /** Other rounds this one could extend (a bridge or an extension). */
  readonly rounds: readonly RoundOption[];
  /** A past round: what it raised outside Capital Q comes first. */
  readonly past?: boolean;
}) {
  const set = <K extends keyof TermsDraft>(key: K, value: TermsDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const amountField = (
    key: "valuationAmount" | "valuationCap" | "hardCap" | "reportedRaised",
    label: string,
    description?: string,
  ) => (
    <Input
      id={`${id}-${key}`}
      label={`${label} (${currency})`}
      description={description}
      inputMode="decimal"
      autoComplete="off"
      placeholder="Not said"
      value={draft[key]}
      onChange={(event) => set(key, event.target.value)}
    />
  );
  const reported = amountField(
    "reportedRaised",
    "Raised outside Capital Q",
    "Your own figure, shown as founder-reported. Money received on Capital Q is counted for you.",
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {past ? <div className="sm:col-span-2">{reported}</div> : null}
      {amountField("valuationCap", "Valuation cap", "For a SAFE, ASA or note.")}
      <Input
        id={`${id}-discount`}
        label="Discount (%)"
        inputMode="decimal"
        autoComplete="off"
        placeholder="Not said"
        value={draft.discountPercent}
        onChange={(event) => set("discountPercent", event.target.value)}
      />
      {amountField("valuationAmount", "Valuation", "For a priced round.")}
      <Select
        id={`${id}-basis`}
        label="Valuation is"
        value={draft.valuationBasis}
        options={[
          { value: "POST_MONEY", label: "Post-money" },
          { value: "PRE_MONEY", label: "Pre-money" },
        ]}
        onChange={(event) =>
          set(
            "valuationBasis",
            event.target.value === "PRE_MONEY" ? "PRE_MONEY" : "POST_MONEY",
          )
        }
      />
      {amountField(
        "hardCap",
        "Hard cap",
        "The most you'll take if it's oversubscribed.",
      )}
      <Input
        id={`${id}-close`}
        type="date"
        label="Target close date"
        value={draft.targetCloseOn}
        onChange={(event) => set("targetCloseOn", event.target.value)}
      />
      <Select
        id={`${id}-prorata`}
        label="Pro-rata rights"
        value={draft.proRataRights}
        options={[
          { value: "", label: "Not said" },
          { value: "NONE", label: PRO_RATA_WORDS.NONE },
          { value: "MAJOR_INVESTORS", label: PRO_RATA_WORDS.MAJOR_INVESTORS },
          { value: "ALL", label: PRO_RATA_WORDS.ALL },
        ]}
        onChange={(event) => {
          const value = event.target.value;
          set(
            "proRataRights",
            value === "NONE" || value === "MAJOR_INVESTORS" || value === "ALL"
              ? value
              : "",
          );
        }}
      />
      <Select
        id={`${id}-lead`}
        label="Lead investor"
        value={draft.leadChoice}
        options={[
          { value: "", label: "No lead / not said" },
          ...leads.map((lead) => ({
            value: `rel:${lead.relationshipId}`,
            label: lead.name,
          })),
          { value: "named", label: "Someone not on Capital Q" },
        ]}
        onChange={(event) => set("leadChoice", event.target.value)}
      />
      {draft.leadChoice === "named" ? (
        <Input
          id={`${id}-lead-name`}
          label="Lead's name"
          maxLength={120}
          value={draft.leadName}
          onChange={(event) => set("leadName", event.target.value)}
        />
      ) : null}
      {rounds.length === 0 ? null : (
        <Select
          id={`${id}-extends`}
          label="Extends an earlier round"
          description="For a bridge or an extension."
          value={draft.extendsRoundId}
          options={[
            { value: "", label: "No" },
            ...rounds.map((round) => ({ value: round.id, label: round.name })),
          ]}
          onChange={(event) => set("extendsRoundId", event.target.value)}
        />
      )}
      {past ? null : <div className="sm:col-span-2">{reported}</div>}
    </div>
  );
}
