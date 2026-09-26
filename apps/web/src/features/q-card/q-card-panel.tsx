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
import { Input } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";

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

const SCOPE_OPTIONS = [
  { value: "public_external", label: "Anyone with the link" },
  { value: "network_visible", label: "Capital Q members only" },
  { value: "", label: "Not on the card" },
] as const;

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
  readonly fields: readonly {
    readonly key: QCardField;
    readonly label: string;
  }[];
};

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
          <HandleForm
            subjectLabel={props.name}
            initial={props.suggestedHandle}
            submitLabel="Create Q Card"
            onSubmit={async (handle) => {
              const result = await claimHandleAction(subject, handle);
              if (!result.ok) return result.message;
              setStatus(
                `Your Q Card is live at /@${result.card.handle ?? handle}.`,
              );
              router.refresh();
              return null;
            }}
          />
          <div>
            <button
              type="button"
              className={buttonClassName("quiet", "regular", "-ml-4")}
              onClick={() =>
                askAbout(`Make a Q card for ${props.name} with the handle `)
              }
            >
              Ask Q to make it
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
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
              onSubmit={async (handle) => {
                const result = await claimHandleAction(subject, handle);
                if (!result.ok) return result.message;
                setStatus(
                  `Your handle is now @${result.card.handle ?? handle}.`,
                );
                router.refresh();
                return null;
              }}
            />
          </section>
          <ScopeForm
            key={card.version}
            card={card}
            fields={props.fields}
            onSave={async (input) => {
              const result = await updateQCardAction(subject, input);
              if (!result.ok) return result.message;
              setStatus("Card updated.");
              router.refresh();
              return null;
            }}
          />
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
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

function ScopeForm({
  card,
  fields,
  onSave,
}: {
  readonly card: QCardDto;
  readonly fields: readonly {
    readonly key: QCardField;
    readonly label: string;
  }[];
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const message = await onSave({
      expectedVersion: card.version,
      fieldScopes: scopes,
      indexable,
    });
    setPending(false);
    if (message !== null) setError(message);
  };
  return (
    <form
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-4"
      onSubmit={(event) => void submit(event)}
      aria-busy={pending}
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-heading`} className="cq-label">
          What the card shows
        </h3>
        <p className="cq-caption text-(--cq-text-secondary)">
          The name is always shown. Anything you keep off the card stays on your
          private profile.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {fields.map((field) => (
          <div
            key={field.key}
            className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
          >
            <span className="cq-body-sm" id={`${id}-${field.key}`}>
              {field.label}
            </span>
            <div className="sm:w-64">
              <Select
                id={`${id}-${field.key}-scope`}
                label={`Who sees ${field.label.toLowerCase()}`}
                labelHidden
                value={scopes[field.key] ?? ""}
                options={SCOPE_OPTIONS}
                onChange={(event) => {
                  const next = event.target.value as QCardScope | "";
                  setScopes((current) => {
                    const copy = { ...current };
                    if (next === "") delete copy[field.key];
                    else copy[field.key] = next;
                    return copy;
                  });
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          checked={indexable}
          onChange={(event) => setIndexable(event.target.checked)}
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
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save card"}
        </Button>
      </div>
    </form>
  );
}
