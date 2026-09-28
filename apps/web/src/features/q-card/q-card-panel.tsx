"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import type {
  QCardDto,
  QCardField,
  QCardFieldScopes,
  QCardScope,
  QCardSubjectType,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { Check, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { Input } from "@capital-q/ui/input";

import { useGlobalQ } from "@/components/app-shell/global-q";

import { claimHandleAction, updateQCardAction } from "./q-card-actions";

/**
 * The Q Card on the profile page (BIZ-004): choose or change the handle,
 * see the card, copy its link, download its QR and contact file, and
 * choose which declared fields it shows and to whom. Everything saves
 * through the same command Q's approved `handle.claim` runs; "Ask Q to
 * make it" opens the one Q with a draft instead.
 *
 * Nothing is shown as saved until the server says so: a handle is a public
 * representation, never an optimistic one.
 */

export type QCardPanelProps = {
  readonly subjectType: QCardSubjectType;
  readonly subjectId: string;
  readonly name: string;
  readonly suggestedHandle: string;
  readonly card: QCardDto | null;
  /** The card's shareable URL, e.g. "https://capitalq.app/@kivu". */
  readonly cardUrl: string | null;
  /** The rendered card (server-side, with its QR); shown above the controls. */
  readonly preview: ReactNode;
  /** The fields this card may show, with their labels, name excluded. */
  readonly fields: readonly CardFieldChoice[];
};

export type CardFieldChoice = {
  readonly key: QCardField;
  readonly label: string;
  /** How the owner's current value reads; null when not added yet. */
  readonly value?: string | null | undefined;
};

/**
 * A server action that throws (a dropped connection, or a page opened
 * before a deploy whose action no longer exists) must still end in words,
 * never in a button stuck on "Saving…" (the silent Save of 2026-09-28).
 */
async function settle(
  work: () => Promise<string | null>,
): Promise<string | null> {
  try {
    return await work();
  } catch {
    return "Your change wasn't saved. Reload the page and try again.";
  }
}

const CARD_SAVED = "Saved. Your Q Card shows these fields now.";

export function QCardPanel(props: QCardPanelProps) {
  const { subjectType, subjectId, card } = props;
  const router = useRouter();
  const { askAbout } = useGlobalQ();
  const subject = { subjectType, subjectId };
  const [status, setStatus] = useState("");

  return (
    <div className="flex flex-col gap-8" data-q-card-panel>
      {card === null ? (
        <div className="flex flex-col gap-4">
          <p className="cq-body text-(--cq-text-secondary)">
            A Q Card is {props.name}&apos;s shareable identity: a link and QR
            that open a page showing only what you choose to make public. Choose
            a handle to create it.
          </p>
          <SavedNote text={status} />
          <HandleForm
            subjectLabel={props.name}
            initial={props.suggestedHandle}
            submitLabel="Create Q Card"
            onSubmit={(handle) =>
              settle(async () => {
                const result = await claimHandleAction(subject, handle);
                if (!result.ok) return result.message;
                setStatus(
                  `Your Q Card is live at /@${result.card.handle ?? handle}.`,
                );
                router.refresh();
                return null;
              })
            }
          />
          <div>
            <button
              type="button"
              className={buttonClassName("quiet", "regular", "-ml-4")}
              onClick={() =>
                askAbout(`Make a Q Card for ${props.name} with the handle `)
              }
            >
              Ask Q to make it
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {status === CARD_SAVED ? null : <SavedNote text={status} />}
            {props.preview}
            <ShareRow
              cardUrl={props.cardUrl}
              handle={card.handle}
              qrHref={`/profile/q-card/qr?subjectType=${subjectType}&subjectId=${subjectId}`}
              onCopied={() => setStatus("Link copied.")}
            />
            <p className="cq-caption text-(--cq-text-tertiary)">
              {card.scansLast30Days === 1
                ? "1 scan of your QR in the last 30 days."
                : `${card.scansLast30Days} scans of your QR in the last 30 days.`}{" "}
              Counted by Capital Q only; never who.
            </p>
          </div>
          <section
            aria-labelledby={`${subjectId}-handle`}
            className="flex flex-col gap-3"
          >
            <h3 id={`${subjectId}-handle`} className="cq-label">
              Handle
            </h3>
            <HandleForm
              subjectLabel={props.name}
              initial={card.handle ?? props.suggestedHandle}
              submitLabel="Change handle"
              hint="Your old handle keeps redirecting here for 90 days, and nobody else can take it meanwhile."
              onSubmit={(handle) =>
                settle(async () => {
                  const result = await claimHandleAction(subject, handle);
                  if (!result.ok) return result.message;
                  setStatus(
                    result.card.handle === card.handle
                      ? "Saved. That's already your handle."
                      : `Saved. Your handle is now @${result.card.handle ?? handle}.`,
                  );
                  router.refresh();
                  return null;
                })
              }
            />
          </section>
          <ScopeForm
            key={card.version}
            card={card}
            fields={props.fields}
            saved={status === CARD_SAVED ? CARD_SAVED : ""}
            onChange={() => setStatus("")}
            onSave={(input) =>
              settle(async () => {
                const result = await updateQCardAction(subject, input);
                if (!result.ok) return result.message;
                setStatus(CARD_SAVED);
                router.refresh();
                return null;
              })
            }
          />
        </>
      )}
    </div>
  );
}

function HandleForm({
  subjectLabel,
  initial,
  submitLabel,
  hint,
  onSubmit,
}: {
  readonly subjectLabel: string;
  readonly initial: string;
  readonly submitLabel: string;
  readonly hint?: string | undefined;
  readonly onSubmit: (handle: string) => Promise<string | null>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    const message = await onSubmit(draft);
    setPending(false);
    if (message !== null) setError(message);
  };
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      onSubmit={(event) => void submit(event)}
      aria-busy={pending}
    >
      <div className="min-w-0 flex-1">
        <Input
          id={`${id}-handle`}
          label={`Handle for ${subjectLabel}`}
          labelHidden
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          description={
            hint ??
            "3 to 30 lowercase letters, digits or hyphens. It becomes your address: /@handle."
          }
          error={error}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
        />
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

function ShareRow({
  cardUrl,
  handle,
  qrHref,
  onCopied,
}: {
  readonly cardUrl: string | null;
  readonly handle: string | null;
  readonly qrHref: string;
  readonly onCopied: () => void;
}) {
  if (cardUrl === null || handle === null) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard.writeText(cardUrl).then(onCopied);
        }}
      >
        Copy link
      </Button>
      <a
        href={qrHref}
        download={`${handle}-qr.svg`}
        className={buttonClassName("secondary")}
      >
        Download QR
      </a>
      <a
        href={`/@${handle}`}
        target="_blank"
        rel="noopener"
        className={buttonClassName("quiet")}
      >
        Open public page
      </a>
    </div>
  );
}

const AUDIENCE_WORDS: Readonly<Record<QCardScope, string>> = {
  network_visible: "Capital Q members only",
  public_external: "Anyone with the link",
};

/**
 * What the card shows, field by field: a switch puts a field on the card
 * (members only, the narrower audience, by default); choosing "Anyone with
 * the link" makes it public_external, and the form says so plainly before
 * saving, because that value then travels beyond Capital Q. Nothing
 * narrower than network_visible exists here, so private data has no way
 * onto a card.
 */
function ScopeForm({
  card,
  fields,
  saved,
  onChange,
  onSave,
}: {
  readonly card: QCardDto;
  readonly fields: readonly CardFieldChoice[];
  readonly saved: string;
  readonly onChange: () => void;
  readonly onSave: (input: {
    readonly expectedVersion: number;
    readonly fieldScopes: QCardFieldScopes;
    readonly indexable: boolean;
  }) => Promise<string | null>;
}) {
  const id = useId();
  const [scopes, setScopes] = useState<QCardFieldScopes>(card.fieldScopes);
  const [indexable, setIndexable] = useState(card.indexable);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // What the server last confirmed: the card as read, then each save.
  const [baseline, setBaseline] = useState(() =>
    snapshot(card.fieldScopes, card.indexable),
  );
  const dirty = snapshot(scopes, indexable) !== baseline;
  const newlyPublic = fields.filter(
    (field) =>
      scopes[field.key] === "public_external" &&
      card.fieldScopes[field.key] !== "public_external",
  );
  const set = (key: QCardField, next: QCardScope | null) => {
    onChange();
    setScopes((current) => {
      const copy = { ...current };
      if (next === null) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const message = await onSave({
      expectedVersion: card.version,
      fieldScopes: scopes,
      indexable,
    });
    setPending(false);
    if (message !== null) setError(message);
    else setBaseline(snapshot(scopes, indexable));
  };
  return (
    <form
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-4"
      onSubmit={(event) => void submit(event)}
      aria-busy={pending}
      data-q-card-fields
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-heading`} className="cq-label">
          What the card shows
        </h3>
        <p className="cq-caption text-(--cq-text-secondary)">
          The name is always shown. Switch a field on to add it; it starts as
          members only. Your raise, financials and setup answers stay private
          and can&apos;t go on a card.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {fields.map((field) => {
          const scope = scopes[field.key];
          const on = scope !== undefined;
          const lower = field.label.toLowerCase();
          return (
            <li
              key={field.key}
              className="flex flex-col gap-1 py-2"
              data-card-choice={field.key}
              data-state={scope ?? "off"}
            >
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
                <span className="flex min-w-0 flex-col">
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {field.label}
                  </span>
                  {field.value === undefined ? null : (
                    <span className="cq-caption truncate text-(--cq-text-tertiary)">
                      {field.value ?? "Not added yet"}
                    </span>
                  )}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Show ${lower} on the card`}
                  checked={on}
                  onChange={(event) =>
                    set(
                      field.key,
                      event.target.checked ? "network_visible" : null,
                    )
                  }
                  className="size-5 shrink-0 accent-(--cq-accent)"
                />
              </label>
              {scope === undefined ? null : (
                <fieldset>
                  <legend className="sr-only">Who sees {lower}</legend>
                  <div className="flex flex-wrap gap-x-5">
                    {(["network_visible", "public_external"] as const).map(
                      (choice) => (
                        <label
                          key={choice}
                          className="cq-body-sm flex min-h-11 cursor-pointer items-center gap-2 text-(--cq-text-secondary)"
                        >
                          <input
                            type="radio"
                            name={`${id}-${field.key}`}
                            value={choice}
                            checked={scope === choice}
                            onChange={() => set(field.key, choice)}
                            className="size-4 accent-(--cq-accent)"
                          />
                          {AUDIENCE_WORDS[choice]}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
              )}
            </li>
          );
        })}
      </ul>
      {newlyPublic.length === 0 ? null : (
        <p
          className="cq-body-sm border-l-2 border-(--cq-warning) py-1 pl-3 text-(--cq-text-primary)"
          data-public-warning
        >
          {newlyPublic.map((field) => field.label).join(", ")}{" "}
          {newlyPublic.length === 1 ? "becomes" : "become"} public once you
          save: anyone with the link sees{" "}
          {newlyPublic.length === 1 ? "it" : "them"}, including people outside
          Capital Q.
        </p>
      )}
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          checked={indexable}
          onChange={(event) => {
            onChange();
            setIndexable(event.target.checked);
          }}
          className="mt-1 size-5 accent-(--cq-accent)"
        />
        <span className="flex flex-col gap-0.5">
          <span className="cq-body-sm">
            Let search engines list the public page
          </span>
          <span className="cq-caption text-(--cq-text-secondary)">
            Off by default. Public fields are still visible to anyone with the
            link either way.
          </span>
        </span>
      </label>
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-danger)">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save card"}
        </Button>
        {pending ? null : dirty ? (
          <span className="cq-caption text-(--cq-text-tertiary)">
            Not saved yet.
          </span>
        ) : (
          <SavedNote text={saved} />
        )}
      </div>
    </form>
  );
}

function snapshot(scopes: QCardFieldScopes, indexable: boolean): string {
  return JSON.stringify([
    Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b)),
    indexable,
  ]);
}

/** Quiet, visible, past tense: what just happened. */
function SavedNote({ text }: { readonly text: string }) {
  if (text === "") return null;
  return (
    <p
      role="status"
      className="cq-body-sm flex items-center gap-2 text-(--cq-text-primary)"
      data-q-card-status="saved"
    >
      <Check
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
        aria-hidden
        className="shrink-0 text-(--cq-positive)"
      />
      {text}
    </p>
  );
}
