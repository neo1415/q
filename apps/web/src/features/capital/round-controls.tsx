"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import type {
  CapitalLedgerDto,
  CapitalRoundEventDto,
  CapitalRoundInstrument,
  CapitalRoundStep,
  RecordCapitalRoundStepRequest,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import {
  reviseRoundAction,
  roundHistoryAction,
  roundStepAction,
} from "./capital-actions";
import { money } from "./money";
import { INSTRUMENT_LABELS } from "./round-labels";
import { changedTerms, draftOf, termsFromDraft } from "./round-terms";
import {
  RoundTermsFields,
  type LeadOption,
  type RoundOption,
} from "./round-terms-fields";
import { STEP_EXPLAINED, STEP_WORDS } from "./round-words";

type Round = CapitalLedgerDto["rounds"][number];

/** Steps that carry an amount of money (in the round's currency). */
const WITH_AMOUNT: ReadonlySet<CapitalRoundStep> = new Set([
  "CLOSE",
  "TRANCHE",
  "FINAL_CLOSE",
]);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The one thing to say before a step that may surprise (edge cases in
 * docs/research/2026-10-06/funding-rounds.md): closing with nothing in,
 * reopening, cancelling, opening while another round is raising.
 */
export function stepWarning(
  round: Pick<Round, "status" | "sums" | "terms" | "notices">,
  step: CapitalRoundStep,
  otherRaising: boolean,
): string | null {
  if (
    step === "FINAL_CLOSE" &&
    round.sums.raised === "0" &&
    round.terms.reportedRaised === null
  ) {
    return "Nothing has been received in this round on Capital Q. Close it anyway? You can add what it raised elsewhere in its terms.";
  }
  if (step === "FINAL_CLOSE" && round.sums.confirmed !== "0") {
    return "Some agreed money hasn't been marked received yet. It stays on record and can still be received after the close.";
  }
  if (step === "OPEN" && otherRaising) {
    return "Another round is already raising. This one becomes your current round; investors may ask which one their money goes to.";
  }
  if (step === "REOPEN" && round.status === "CLOSED") {
    return "Reopening is for an extension or a second close. Its earlier closes stay in its history.";
  }
  if (step === "CANCEL") {
    return "Cancelling keeps the round in your history. You can reopen it later.";
  }
  return null;
}

/**
 * A round's controls (plan P8): the lifecycle steps the server says it can
 * take, an edit of its terms, and its history. Each opens one sheet (bottom
 * on a phone, side on desktop). Nothing changes until the founder presses
 * the sheet's own button; every step carries one key per sheet.
 */
export function RoundControls({
  round,
  rounds,
  leads,
}: {
  readonly round: Round;
  readonly rounds: readonly Round[];
  readonly leads: readonly LeadOption[];
}) {
  const [open, setOpen] = useState<
    | { readonly kind: "STEP"; readonly step: CapitalRoundStep }
    | { readonly kind: "EDIT" }
    | { readonly kind: "HISTORY" }
    | null
  >(null);
  const otherRaising = rounds.some(
    (other) =>
      other.id !== round.id &&
      (other.status === "OPEN" || other.status === "FIRST_CLOSED"),
  );
  return (
    <div className="flex flex-wrap gap-2">
      {round.steps.map((step) => (
        <Button
          key={step}
          variant={
            step === "CANCEL" || step === "REOPEN" ? "quiet" : "secondary"
          }
          size="compact"
          onClick={() => setOpen({ kind: "STEP", step })}
        >
          {STEP_WORDS[step]}
        </Button>
      ))}
      <Button
        variant="quiet"
        size="compact"
        onClick={() => setOpen({ kind: "EDIT" })}
      >
        Edit terms
      </Button>
      <Button
        variant="quiet"
        size="compact"
        onClick={() => setOpen({ kind: "HISTORY" })}
      >
        History
        {round.corrections === 0
          ? null
          : ` (${String(round.corrections)} edit${round.corrections === 1 ? "" : "s"})`}
      </Button>
      <SheetRoot
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        {open?.kind === "STEP" ? (
          <SheetContent
            side="side"
            title={`${STEP_WORDS[open.step]}: ${round.name}`}
            description={STEP_EXPLAINED[open.step]}
          >
            <StepForm
              round={round}
              step={open.step}
              warning={stepWarning(round, open.step, otherRaising)}
              onDone={() => setOpen(null)}
            />
          </SheetContent>
        ) : open?.kind === "EDIT" ? (
          <SheetContent
            side="side"
            title={`Edit ${round.name}`}
            description="Changes are kept in the round's history, with what they replaced."
          >
            <EditForm
              round={round}
              rounds={rounds}
              leads={leads}
              onDone={() => setOpen(null)}
            />
          </SheetContent>
        ) : open?.kind === "HISTORY" ? (
          <SheetContent
            side="side"
            title={`${round.name}: history`}
            description="Every change to this round, newest first."
          >
            <History roundId={round.id} currency={round.target.currency} />
          </SheetContent>
        ) : null}
      </SheetRoot>
    </div>
  );
}

function StepForm({
  round,
  step,
  warning,
  onDone,
}: {
  readonly round: Round;
  readonly step: CapitalRoundStep;
  readonly warning: string | null;
  readonly onDone: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [on, setOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [words, setWords] = useState("");
  const [key] = useState(() => `round-step:${crypto.randomUUID()}`);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const withAmount = WITH_AMOUNT.has(step);
  const isReason = step === "CANCEL" || step === "REOPEN";

  const submit = () =>
    start(async () => {
      const clean = amount.replace(/[\s,]/g, "");
      const request: RecordCapitalRoundStepRequest = {
        expectedRevision: round.revision,
        step,
        ...(on === "" ? {} : { on }),
        ...(withAmount && clean !== "" ? { amount: clean } : {}),
        ...(words.trim() === ""
          ? {}
          : isReason
            ? { note: words.trim() }
            : { label: words.trim() }),
      };
      const result = await roundStepAction(round.id, request, key);
      if (result.ok) {
        onDone();
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });

  return (
    <form
      className="flex flex-col gap-4 overflow-y-auto pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {warning === null ? null : (
        <p
          className="cq-body-sm rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-3 text-(--cq-text-primary)"
          role="note"
        >
          {warning}
        </p>
      )}
      <Input
        id={`${id}-on`}
        type="date"
        label="When"
        value={on}
        onChange={(event) => setOn(event.target.value)}
      />
      {withAmount ? (
        <Input
          id={`${id}-amount`}
          label={`Amount (${round.target.currency}), if you know it`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Not said"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      ) : null}
      {step === "OPEN" ? null : (
        <Input
          id={`${id}-words`}
          label={isReason ? "Why (optional)" : "Label (optional)"}
          placeholder={
            isReason
              ? step === "CANCEL"
                ? "Lead pulled out"
                : "Seed extension"
              : step === "TRANCHE"
                ? "Tranche 2: 1,000 paying customers"
                : "Second close"
          }
          maxLength={isReason ? 300 : 120}
          value={words}
          onChange={(event) => setWords(event.target.value)}
        />
      )}
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-danger)" role="alert">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {STEP_WORDS[step]}
        </Button>
        <Button variant="quiet" disabled={pending} onClick={onDone}>
          Not now
        </Button>
      </div>
    </form>
  );
}

const INSTRUMENTS: readonly CapitalRoundInstrument[] = [
  "SAFE",
  "EQUITY",
  "CONVERTIBLE",
  "ASA",
  "OTHER",
];

function EditForm({
  round,
  rounds,
  leads,
  onDone,
}: {
  readonly round: Round;
  readonly rounds: readonly Round[];
  readonly leads: readonly LeadOption[];
  readonly onDone: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [name, setName] = useState(round.name);
  const [target, setTarget] = useState(round.target.amount);
  const [instrument, setInstrument] = useState(round.instrument);
  const [draft, setDraft] = useState(() => draftOf(round.terms));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const others: RoundOption[] = rounds
    .filter((other) => other.id !== round.id)
    .map((other) => ({ id: other.id, name: other.name }));

  const submit = () =>
    start(async () => {
      const cleanTarget = target.replace(/[\s,]/g, "");
      const terms = termsFromDraft(draft, {
        target: cleanTarget,
        currency: round.target.currency,
      });
      if (!terms.ok) {
        setMessage(terms.message);
        return;
      }
      const changed = changedTerms(round.terms, terms.terms);
      const request = {
        expectedRevision: round.revision,
        ...(name.trim() !== round.name ? { name: name.trim() } : {}),
        ...(cleanTarget !== round.target.amount
          ? {
              target: {
                amount: cleanTarget,
                currency: round.target.currency,
              },
            }
          : {}),
        ...(instrument !== round.instrument ? { instrument } : {}),
        ...(Object.keys(changed).length === 0 ? {} : { terms: changed }),
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      };
      if (Object.keys(request).length === 1) {
        onDone();
        return;
      }
      const result = await reviseRoundAction(round.id, request);
      if (result.ok) {
        onDone();
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });

  return (
    <form
      className="flex flex-col gap-4 overflow-y-auto pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        id={`${id}-name`}
        label="Name"
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        id={`${id}-target`}
        label={`Target (${round.target.currency})`}
        inputMode="decimal"
        value={target}
        onChange={(event) => setTarget(event.target.value)}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="cq-label mb-2 text-(--cq-text-primary)">
          Instrument
        </legend>
        <div className="flex flex-wrap gap-2">
          {INSTRUMENTS.map((value) => (
            <label
              key={value}
              className="cq-body-sm inline-flex min-h-11 cursor-pointer items-center rounded-full border border-(--cq-border) px-4 text-(--cq-text-primary) has-checked:border-transparent has-checked:bg-(--cq-accent-soft) has-focus-visible:outline-2 has-focus-visible:outline-(--cq-focus-ring)"
            >
              <input
                type="radio"
                name={`${id}-instrument`}
                value={value}
                checked={instrument === value}
                onChange={() => setInstrument(value)}
                className="sr-only"
              />
              {INSTRUMENT_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <RoundTermsFields
        id={id}
        draft={draft}
        onChange={setDraft}
        currency={round.target.currency}
        leads={leads}
        rounds={others}
        past={round.status === "CLOSED"}
      />
      <Input
        id={`${id}-note`}
        label="Why the change (optional)"
        maxLength={500}
        placeholder="Corrected after the term sheet"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-danger)" role="alert">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          Save changes
        </Button>
        <Button variant="quiet" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const EVENT_WORDS: Readonly<Record<CapitalRoundEventDto["type"], string>> = {
  CREATED: "Added",
  TERMS_REVISED: "Edited",
  OPENED: "Started raising",
  CLOSE_RECORDED: "Close",
  TRANCHE_RECORDED: "Tranche",
  FINAL_CLOSED: "Final close",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

const FIELD_WORDS: Readonly<Record<string, string>> = {
  name: "Name",
  target: "Target",
  instrument: "Instrument",
  openedOn: "Opened",
  targetCloseOn: "Target close date",
  valuation: "Valuation",
  valuationCap: "Valuation cap",
  discountPercent: "Discount %",
  hardCap: "Hard cap",
  proRataRights: "Pro-rata",
  lead: "Lead",
  extendsRoundId: "Extends",
  reportedRaised: "Raised outside Capital Q",
};

/** A history value in words: ids become what they are, never a uuid. */
function changeText(value: string | null, empty: string): string {
  if (value === null) return empty;
  if (value.startsWith("relationship:")) return "an investor on Capital Q";
  if (/^[0-9a-f-]{36}$/.test(value)) return "another of your rounds";
  return value
    .replace(/ POST_MONEY$/, " post-money")
    .replace(/ PRE_MONEY$/, " pre-money")
    .replace(/^MAJOR_INVESTORS$/, "major investors")
    .replace(/^ALL$/, "every investor")
    .replace(/^NONE$/, "none");
}

function History({
  roundId,
  currency,
}: {
  readonly roundId: string;
  readonly currency: string;
}) {
  const [events, setEvents] = useState<
    readonly CapitalRoundEventDto[] | "loading" | "failed"
  >("loading");
  useEffect(() => {
    let live = true;
    void roundHistoryAction(roundId).then((history) => {
      if (live) setEvents(history === null ? "failed" : history.events);
    });
    return () => {
      live = false;
    };
  }, [roundId]);
  if (events === "loading") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)" aria-busy="true">
        Loading…
      </p>
    );
  }
  if (events === "failed") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        The history couldn&apos;t load. Try again in a moment.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3 overflow-y-auto pb-2">
      {[...events].reverse().map((event) => (
        <li
          key={event.revision}
          className="flex flex-col gap-1 border-b border-(--cq-border-subtle) pb-3 last:border-b-0"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="cq-body-sm font-semibold text-(--cq-text-primary)">
              {EVENT_WORDS[event.type]}
              {event.amount === null
                ? null
                : `, ${money(event.amount, event.currencyCode ?? currency)}`}
            </span>
            <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
              {event.on}
              {event.byYou ? ", by you" : ""}
            </span>
          </div>
          {event.label === null ? null : (
            <span className="cq-caption text-(--cq-text-secondary)">
              {event.label}
            </span>
          )}
          {event.note === null ? null : (
            <span className="cq-caption text-(--cq-text-secondary)">
              {event.note}
            </span>
          )}
          {event.changes.length === 0 ? null : (
            <ul className="flex flex-col gap-0.5">
              {event.changes.map((change) => (
                <li
                  key={change.field}
                  className="cq-caption text-(--cq-text-secondary)"
                >
                  {FIELD_WORDS[change.field] ?? change.field}: was{" "}
                  {changeText(change.from, "not said")}, now{" "}
                  {changeText(change.to, "cleared")}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
