"use client";

import { useId, useState, type ChangeEvent } from "react";

import {
  Q_BRAND_LOGO_MAX_BYTES,
  Q_FONT_PAIRINGS,
  type QBrandKit,
  type QBrandKitState,
  type QFontPairing,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { fieldControlClassName } from "@capital-q/ui/input";
import { InlineNotice } from "@capital-q/ui/states";

import {
  answerBrandSuggestionAction,
  readBrandKitAction,
  setBrandKitAction,
  suggestBrandKitAction,
} from "./actions";

/**
 * The brand a person's documents are drawn in (DOCS spec §3 F4; BIZ-005).
 *
 * Their logo, colours and type pairing. Q can read their website and
 * suggest one; a suggestion applies to nothing until they press "Use this
 * brand". Values they set themselves are theirs and apply as given. This
 * is content about their company: it colours their documents, never the
 * Capital Q app (the swatches below are the only place a brand colour is
 * drawn here, each with its hex value written beside it).
 */

export const PAIRING_LABELS: Readonly<Record<QFontPairing, string>> = {
  INTER_SOURCE_SERIF: "Source Serif headings, Inter text",
  PLEX_SANS_PLEX_SERIF: "IBM Plex Serif headings, IBM Plex Sans text",
  SOURCE_SANS_FRAUNCES: "Fraunces headings, Source Sans text",
  INTER_ONLY: "Inter throughout",
};

function pairingLabel(code: string | undefined): string {
  const known = Q_FONT_PAIRINGS.find((pairing) => pairing === code);
  return known === undefined ? "The deck's own type" : PAIRING_LABELS[known];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function Swatch({
  label,
  hex,
}: {
  readonly label: string;
  readonly hex: string;
}) {
  return (
    <li className="flex items-center gap-2" data-brand-swatch={label}>
      <span
        aria-hidden="true"
        className="size-6 shrink-0 rounded-sm border border-(--cq-border-subtle)"
        // Content about their company, drawn only as a sample.
        style={{ background: hex }}
      />
      <span className="cq-body-sm text-(--cq-text-primary)">{label}</span>
      <span className="cq-caption font-mono text-(--cq-text-tertiary)">
        {hex.toLowerCase()}
      </span>
    </li>
  );
}

function KitSummary({ kit }: { readonly kit: QBrandKit }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
      {kit.hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, session-scoped image route; next/image would cache it publicly.
        <img
          src={`/api/q-brand-kit/logo?version=${String(kit.version)}`}
          alt="Your logo"
          className="h-12 w-auto max-w-40 object-contain"
        />
      ) : null}
      <div className="flex flex-col gap-2">
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <Swatch label="Primary" hex={kit.palette.primary} />
          {kit.palette.secondary === undefined ? null : (
            <Swatch label="Secondary" hex={kit.palette.secondary} />
          )}
          {kit.palette.background === undefined ? null : (
            <Swatch label="Page" hex={kit.palette.background} />
          )}
          {kit.palette.ink === undefined ? null : (
            <Swatch label="Text" hex={kit.palette.ink} />
          )}
        </ul>
        <p className="cq-caption text-(--cq-text-secondary)">
          {pairingLabel(kit.pairing)}
        </p>
      </div>
    </div>
  );
}

async function readAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function BrandForm({
  from,
  onSaved,
  onCancel,
}: {
  readonly from: QBrandKit | undefined;
  readonly onSaved: (kit: QBrandKit) => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [primary, setPrimary] = useState(from?.palette.primary ?? "#1f4f7a");
  const [secondary, setSecondary] = useState(from?.palette.secondary ?? "");
  const [pairing, setPairing] = useState<string>(from?.pairing ?? "");
  const [logo, setLogo] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setMessage(null);
    if (file === undefined) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setMessage("The logo must be a PNG or JPEG.");
      return;
    }
    if (file.size > Q_BRAND_LOGO_MAX_BYTES) {
      setMessage("The logo must be at most 512 KB.");
      return;
    }
    setLogo(await readAsBase64(file));
    setRemoveLogo(false);
  };

  const save = async () => {
    if (!HEX.test(primary) || (secondary !== "" && !HEX.test(secondary))) {
      setMessage("Each colour is a hex value like #1f4f7a.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await setBrandKitAction({
      primary,
      ...(secondary === "" ? {} : { secondary }),
      ...(pairing === "" ? {} : { pairing }),
      ...(logo === null ? {} : { logoBase64: logo }),
      ...(removeLogo ? { removeLogo: true } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    onSaved(result.value);
  };

  const colourField = (
    label: string,
    value: string,
    set: (next: string) => void,
    optional: boolean,
  ) => (
    <div className="flex flex-col gap-1">
      <label
        className="cq-label text-(--cq-text-secondary)"
        htmlFor={`${id}-${label}`}
      >
        {label}
        {optional ? " (optional)" : ""}
      </label>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={HEX.test(value) ? value : "#ffffff"}
          onChange={(event) => set(event.target.value)}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-md border border-(--cq-border-subtle) bg-transparent"
        />
        <input
          id={`${id}-${label}`}
          type="text"
          inputMode="text"
          spellCheck={false}
          placeholder="#1f4f7a"
          value={value}
          onChange={(event) => set(event.target.value.trim())}
          className={`${fieldControlClassName} h-11 !w-32 font-mono cq-body`}
        />
      </span>
    </div>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      data-brand-form
    >
      <div className="flex flex-wrap gap-4">
        {colourField("Primary", primary, setPrimary, false)}
        {colourField("Secondary", secondary, setSecondary, true)}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="cq-label text-(--cq-text-secondary)">Fonts</legend>
        {Q_FONT_PAIRINGS.map((code) => (
          <label
            key={code}
            className="flex min-h-11 items-center gap-3 cq-body-sm text-(--cq-text-primary)"
          >
            <input
              type="radio"
              name={`${id}-pairing`}
              value={code}
              checked={pairing === code}
              onChange={() => setPairing(code)}
            />
            {PAIRING_LABELS[code]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <label
          className="cq-label text-(--cq-text-secondary)"
          htmlFor={`${id}-logo`}
        >
          Logo (PNG or JPEG, up to 512 KB)
        </label>
        <input
          id={`${id}-logo`}
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => void onLogo(event)}
          className="cq-body-sm min-h-11"
        />
        {from?.hasLogo === true && logo === null ? (
          <label className="flex min-h-11 items-center gap-3 cq-body-sm text-(--cq-text-primary)">
            <input
              type="checkbox"
              checked={removeLogo}
              onChange={(event) => setRemoveLogo(event.target.checked)}
            />
            Remove the current logo
          </label>
        ) : null}
      </div>
      {message === null ? null : (
        <InlineNotice tone="warning">{message}</InlineNotice>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={buttonClassName("primary", "regular")}
          disabled={busy}
          data-brand-save
        >
          {busy ? "Saving…" : "Save brand"}
        </button>
        <button
          type="button"
          className={buttonClassName("quiet", "regular")}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function hostOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function BrandKitPanel({
  initial,
}: {
  /** Null when the brand could not be read. */
  readonly initial: QBrandKitState | null;
}) {
  const [state, setState] = useState<QBrandKitState | null>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"suggest" | "answer" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const read = await readBrandKitAction();
    if (read.ok) setState(read.value);
  };

  const suggest = async () => {
    setBusy("suggest");
    setMessage(null);
    const result = await suggestBrandKitAction();
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    await refresh();
  };

  const answer = async (version: number, decision: "CONFIRM" | "DECLINE") => {
    setBusy("answer");
    setMessage(null);
    const result = await answerBrandSuggestionAction({ version, decision });
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
    }
    await refresh();
  };

  const effective = state?.effective;
  const suggestion = state?.suggestion;
  const host = hostOf(suggestion?.sourceUrl);

  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="brand-kit"
      data-brand-kit
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="brand-kit" className="cq-title-sm text-(--cq-text-primary)">
          Brand
        </h2>
        {editing ? null : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClassName("quiet", "regular")}
              onClick={() => void suggest()}
              disabled={busy !== null}
              data-brand-suggest
            >
              {busy === "suggest" ? "Reading your website…" : "Read my website"}
            </button>
            <button
              type="button"
              className={buttonClassName("secondary", "regular")}
              onClick={() => setEditing(true)}
              data-brand-edit
            >
              {effective === undefined ? "Set my brand" : "Edit"}
            </button>
          </div>
        )}
      </div>

      {state === null ? (
        <p
          className="cq-body text-(--cq-text-secondary)"
          data-state="unavailable"
        >
          Your brand couldn&apos;t be read just now. Reload in a moment.
        </p>
      ) : editing ? (
        <BrandForm
          from={effective}
          onSaved={(kit) => {
            setEditing(false);
            setState({ ...state, effective: kit });
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {suggestion === undefined ? null : (
            <div
              className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) p-4"
              data-brand-suggestion={suggestion.version}
            >
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {suggestion.source === "WEBSITE"
                  ? `Q found these on ${host ?? "your website"}. Nothing changes until you use them.`
                  : "Q suggests this look. Nothing changes until you use it."}
              </p>
              <KitSummary kit={suggestion} />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClassName("primary", "regular")}
                  disabled={busy !== null}
                  onClick={() => void answer(suggestion.version, "CONFIRM")}
                  data-brand-confirm
                >
                  Use this brand
                </button>
                <button
                  type="button"
                  className={buttonClassName("quiet", "regular")}
                  disabled={busy !== null}
                  onClick={() => void answer(suggestion.version, "DECLINE")}
                  data-brand-decline
                >
                  Not now
                </button>
              </div>
            </div>
          )}
          {effective === undefined ? (
            suggestion === undefined ? (
              <p
                className="cq-body text-(--cq-text-secondary)"
                data-state="empty"
              >
                No brand yet. Q can read your website for your colours and logo,
                or set them yourself. Your documents use Capital Q&apos;s calm
                default until then.
              </p>
            ) : null
          ) : (
            <div data-brand-effective={effective.version}>
              <KitSummary kit={effective} />
              <p className="cq-caption mt-2 text-(--cq-text-tertiary)">
                New decks use this brand. Ask Q to apply it to one you already
                have.
              </p>
            </div>
          )}
        </>
      )}
      {message === null ? null : (
        <InlineNotice tone="warning">{message}</InlineNotice>
      )}
    </section>
  );
}
