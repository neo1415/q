"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import {
  parseStartupDescription,
  type GatewayPolicyDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  Bookmark,
  Copy,
  ICON_SIZE,
  ICON_STROKE,
  Lock,
  Search,
  Shield,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";

import {
  findStartupsAction,
  replyPromiseAction,
  saveAlertAction,
  type FoundStartup,
} from "./gateq-actions";
import { ErrorBlock, Skeleton, StateBlock } from "./gateq-chrome";
import { CopyLink } from "./inbox-view";
import { monogram } from "./inbox-model";
import { useT } from "@/features/i18n/language";

/**
 * The investor's "Find a startup" and "Your gate" (F3, F2; design
 * a/gateq.html). Find reads their description deterministically into
 * visible chips and Discover's own filters over the companies they may
 * already see; saving it is an alert, never a change to their mandate.
 * Your gate shows who can apply, the rules founders see, the reply promise
 * and the ways to share the gate.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

const STAGE_WORDS: Readonly<Record<string, string>> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c_plus: "Series C+",
};

export function FindView({
  state,
  initialText = "",
  initialResults = null,
  limited = false,
}: {
  readonly state: "full" | "loading" | "empty" | "error" | "limited";
  readonly initialText?: string;
  readonly initialResults?: readonly FoundStartup[] | null;
  readonly limited?: boolean;
}) {
  const t = useT();

  const [text, setText] = useState(initialText);
  const [results, setResults] = useState<readonly FoundStartup[] | null>(
    initialResults,
  );
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const query = useMemo(() => parseStartupDescription(text), [text]);

  const find = () =>
    startTransition(async () => {
      const found = await findStartupsAction(text);
      setFailed(!found.ok);
      setResults(found.ok ? found.value : []);
    });

  return (
    <>
      {/* Design gateq-2: one line to describe it, and Find beside it. */}
      <form
        className="gq2-findq"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && text.trim().length >= 3) find();
        }}
      >
        <label className="gq2-sbar">
          <Search {...icon} size={18} />
          <span className="sr-only">
            {t("Describe the company you're looking for")}
          </span>
          <input
            id="gq-find"
            value={text}
            maxLength={500}
            placeholder={t("Describe the company you're looking for")}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <Button
          variant="primary"
          type="submit"
          disabled={pending || text.trim().length < 3}
        >
          {t("Find")}
        </Button>
      </form>
      <div className="flex flex-col gap-3">
        {results === null && !pending ? (
          <p className="cq-body-sm gq-t2">
            {t("Like")}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => setText("Climate hardware in East Africa")}
            >
              {t("“climate hardware in East Africa”")}
            </button>
            {t(". Q searches companies on Capital Q you are allowed to see.")}
          </p>
        ) : null}
        {query.chips.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="cq-caption gq-t2">{t("Q understood:")}</span>
            {query.chips.map((chip) => (
              <span
                key={`${chip.dimension}-${chip.label}`}
                className="gq-mini"
                style={{ fontSize: 13, padding: "4px 10px" }}
                title={
                  chip.checkable
                    ? undefined
                    : t(
                        "Companies don't share this with Capital Q yet, so it isn't checked",
                      )
                }
              >
                {t(chip.label)}
                {chip.checkable ? "" : t(" (not checked)")}
              </span>
            ))}
          </div>
        )}
      </div>
      {limited ? (
        <div className="gq-banner">
          <Shield {...icon} />
          <span>
            {t(
              "Showing companies open to everyone. Verify your firm to search companies that share only with verified investors.",
            )}
          </span>
        </div>
      ) : null}
      {notice === null ? null : (
        <div className="gq-banner" role="status">
          <Bookmark {...icon} />
          <span>{t(notice)}</span>
        </div>
      )}
      {state === "loading" || pending ? (
        <>
          <div className="flex items-center gap-3 rounded-xl bg-(--cq-surface-subtle) p-3.5">
            <QNavIcon size={22} strokeWidth={2} aria-hidden />
            <span className="cq-body-sm">
              {t("Searching the companies you can see…")}
            </span>
          </div>
          <Skeleton width="100%" height={70} />
          <Skeleton width="100%" height={70} />
        </>
      ) : state === "error" || failed ? (
        <ErrorBlock t={t} what="Your search" retryHref="/gateq?tab=find" />
      ) : state === "empty" || (results !== null && results.length === 0) ? (
        <StateBlock
          icon={
            <Search
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
          }
          title={t("No company on Capital Q matches all of that yet")}
          body={t(
            "Save it as an alert and it stays on your Find tab. Or loosen one part of the description.",
          )}
        >
          <Button
            variant="primary"
            onClick={() =>
              startTransition(async () => {
                const done = await saveAlertAction({
                  description: text,
                  clientRequestId: `alert-${crypto.randomUUID()}`,
                });
                setNotice(
                  done.ok
                    ? "Saved as an alert. It never changes your mandate."
                    : done.message,
                );
              })
            }
          >
            {t("Save as alert")}
          </Button>
        </StateBlock>
      ) : results === null ? null : (
        <>
          <div className="gq-sect-h mt-2">
            <h2 className="gq2-h3">
              {t(
                results.length === 1
                  ? "1 company on Capital Q"
                  : `${String(results.length)} companies on Capital Q`,
              )}
            </h2>
            <Button
              size="compact"
              onClick={() =>
                startTransition(async () => {
                  const done = await saveAlertAction({
                    description: text,
                    clientRequestId: `alert-${crypto.randomUUID()}`,
                  });
                  setNotice(
                    done.ok
                      ? "Saved as an alert. It never changes your mandate."
                      : done.message,
                  );
                })
              }
            >
              <Bookmark {...icon} />
              {t("Save as alert")}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {results.map((company) => (
              <Link
                key={company.companyId}
                className="gq2-found"
                href={`/company/${company.companyId}`}
              >
                <span className="gq2-mono" aria-hidden>
                  {monogram(company.name)}
                </span>
                <span className="min-w-0">
                  <b className="font-semibold">{company.name}</b>
                  {company.oneLiner === null ? null : (
                    <span className="cq-body-sm block">
                      {t(company.oneLiner)}
                    </span>
                  )}
                  <span className="cq-caption gq-t2">
                    {t(
                      [
                        company.stage === null
                          ? null
                          : (STAGE_WORDS[company.stage] ?? company.stage),
                        company.country,
                      ]
                        .filter((part) => part !== null)
                        .join(" · "),
                    )}
                  </span>
                </span>
                <span className="gq2-tag gq2-q-no">{t("In your Discover")}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      <div className="gq-card flex flex-wrap items-center gap-3 p-4">
        <span className="min-w-[220px] flex-1">
          <b className="font-medium">{t("Know a company that isn't here?")}</b>
          <span className="cq-body-sm gq-t2 block">
            {t(
              "Send them your gate link. They check their fit in two minutes.",
            )}
          </span>
        </span>
        <Link
          href="/gateq?tab=gate"
          className={buttonClassName("secondary", "compact")}
        >
          {t("Share your gate")}
        </Link>
      </div>
    </>
  );
}

const DIMENSION_WORDS: Readonly<Record<string, string>> = {
  TAXONOMY: "Sector",
  EXCLUDED_TAXONOMY: "Never",
  GEOGRAPHY: "Location",
  STAGE: "Stage",
  RAISE_SIZE: "Round size",
  CHEQUE_COMPATIBILITY: "Cheque size",
};

/** How strict the gate is: the policy's inbound mode, with its consequence. */
const STRICT: readonly (readonly [string, string, string])[] = [
  [
    "QUALIFIED",
    "Only companies that meet my rules",
    "Others see why and can't send.",
  ],
  ["OPEN", "Anyone can send", "Founders still see your rules and how they stand."],
];

export function GateView({
  state,
  gatewayId,
  policy,
  link,
  snippet,
  qr,
  replyWithinDays,
  canDecide,
  editor,
}: {
  readonly state: "full" | "loading" | "empty" | "error" | "limited";
  readonly gatewayId: string;
  readonly policy: GatewayPolicyDto | null;
  readonly link: string;
  readonly snippet: string;
  /** Server-rendered SVG from Capital Q's own encoder; no user markup. */
  readonly qr: string;
  readonly replyWithinDays: number | null;
  readonly canDecide: boolean;
  readonly editor?: ReactNode;
}) {
  const t = useT();

  const [days, setDays] = useState(
    replyWithinDays === null ? "" : String(replyWithinDays),
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [promise, setPromise] = useState<number | null>(replyWithinDays);
  const [changingPromise, setChangingPromise] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showSnippet, setShowSnippet] = useState(false);
  const [pending, startTransition] = useTransition();
  if (state === "loading") {
    return (
      <>
        <Skeleton width="100%" height={120} />
        <Skeleton width="100%" height={220} />
      </>
    );
  }
  if (state === "error")
    return <ErrorBlock t={t} what="Your gate" retryHref="/gateq?tab=gate" />;
  const mode =
    state === "empty" ? "CLOSED" : (policy?.version.inboundMode ?? "QUALIFIED");
  const rules = policy?.criteria ?? [];
  const openEditor = () => {
    setEditing(true);
    window.setTimeout(
      () =>
        document
          .getElementById("gq2-editor")
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      0,
    );
  };
  const savePromise = () => {
    const value = days.trim() === "" ? null : Number(days);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 60)) {
      setSaved("Use a number of working days from 1 to 60.");
      return;
    }
    startTransition(async () => {
      const done = await replyPromiseAction(gatewayId, {
        replyWithinDays: value,
      });
      if (done.ok) {
        setPromise(value);
        setChangingPromise(false);
      }
      setSaved(
        done.ok
          ? value === null
            ? "No promise shown."
            : "Saved. Founders see it before they apply."
          : done.message,
      );
    });
  };
  // Design gateq-2, "Your gate": the published rules on the left; how
  // strict, the promise to founders and the link beside them.
  return (
    <div className="gq2-cols">
      <div className="flex min-w-0 flex-col">
        {canDecide ? null : (
          <div className="gq-banner mb-3.5">
            <Lock {...icon} />
            <span>
              {t(
                "Only admins of your firm can change the gate. You can copy and share the link.",
              )}
            </span>
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
          <h2 className="gq2-h3">{t("Your published rules")}</h2>
          {editing ? (
            <span className="cq-caption gq-t3 ms-auto">
              {t(
                "Nothing is live until you publish. Remove anything Q read wrong.",
              )}
            </span>
          ) : null}
        </div>
        {rules.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="cq-body-sm gq-t2">
              {t(
                "No published rules yet, so nothing is checked: founders see no judgement either way. Give Q your mandate and it drafts the rules; you confirm each one.",
              )}
            </p>
            {canDecide && editor !== undefined && !editing ? (
              <Button variant="primary" onClick={openEditor}>
                {t("Draft criteria from your mandate")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div>
            {rules.map((rule) => (
              <div key={rule.id} className="gq2-rule">
                <span className="min-w-0">
                  <b>{t(rule.label)}</b>
                  <small>
                    {t(DIMENSION_WORDS[rule.config.type] ?? "Rule")}
                  </small>
                </span>
                <span className="gq2-lvl">
                  {rule.requiredness === "REQUIRED"
                    ? t("Required")
                    : t("Preferred")}
                </span>
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={!canDecide || editor === undefined}
                  onClick={openEditor}
                  aria-label={t(`Edit ${rule.label}`)}
                >
                  {t("Edit")}
                </Button>
              </div>
            ))}
          </div>
        )}
        {editing && canDecide ? (
          <div id="gq2-editor" className="mt-4 flex flex-col gap-3">
            {editor}
            <Button
              variant="quiet"
              size="compact"
              className="self-start"
              onClick={() => setEditing(false)}
            >
              {t("Done")}
            </Button>
          </div>
        ) : null}
      </div>

      <aside className="flex min-w-0 flex-col gap-3.5">
        <section className="gq2-card" aria-labelledby="gq2-strict">
          <h3 id="gq2-strict">{t("How strict")}</h3>
          <div role="radiogroup" aria-labelledby="gq2-strict">
            {STRICT.map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className="gq2-ropt"
                disabled={!canDecide || editor === undefined}
                onClick={() => (mode === value ? undefined : openEditor())}
              >
                <span className="gq2-rdot" aria-hidden />
                <span>
                  <b>{t(label)}</b>
                  <small>{t(hint)}</small>
                </span>
              </button>
            ))}
          </div>
          {mode === "CLOSED" ? (
            <p className="cq-caption gq-t2">
              {t(
                "Your gate is closed. Founders see that you're not taking applications right now.",
              )}
            </p>
          ) : null}
        </section>

        <section className="gq2-card" aria-labelledby="gq2-promise">
          <h3 id="gq2-promise">{t("Promise to founders")}</h3>
          {changingPromise && canDecide ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                savePromise();
              }}
            >
              <span className="cq-body-sm">{t("Reply within")}</span>
              <input
                className="gq-input"
                style={{ width: 72 }}
                inputMode="numeric"
                aria-label={t("Working days")}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
              <span className="cq-body-sm">{t("working days")}</span>
              <Button size="compact" type="submit" disabled={pending}>
                {t("Save")}
              </Button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="cq-body text-(--cq-text-primary)">
                {promise === null
                  ? t("No reply promise yet")
                  : t(
                      `Reply within ${String(promise)} working day${promise === 1 ? "" : "s"}`,
                    )}
              </p>
              {canDecide ? (
                <Button
                  variant="quiet"
                  size="compact"
                  onClick={() => setChangingPromise(true)}
                >
                  {t("Change")}
                </Button>
              ) : null}
            </div>
          )}
          <p className="cq-caption gq-t3">
            {t("Shown on your gate. Late replies are marked in your inbox.")}
          </p>
          {saved === null ? null : (
            <p className="cq-caption gq-t2" role="status">
              {t(saved)}
            </p>
          )}
        </section>

        <section className="gq2-card" aria-labelledby="gq2-link">
          <h3 id="gq2-link">{t("Your gate link")}</h3>
          <CopyLink text={link} />
          <p className="cq-caption gq-t3">
            {t("Also as a")}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => setShowQr(true)}
            >
              {t("QR code")}
            </button>{" "}
            {t("and a")}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => setShowSnippet(!showSnippet)}
              aria-expanded={showSnippet}
            >
              {t("snippet for your website")}
            </button>
            .
          </p>
          {showSnippet ? (
            <div className="flex flex-col gap-2">
              <code className="cq-caption block break-all rounded-(--cq-radius-md) bg-(--cq-surface-subtle) p-3">
                <Copy {...icon} className="me-1.5 inline" />
                {snippet}
              </code>
              <CopyLink text={snippet} label={t("Copy snippet")} />
            </div>
          ) : null}
          <Link
            href={link.replace(/^https?:\/\/[^/]+/, "")}
            className={buttonClassName("quiet", "compact", "self-start")}
            target="_blank"
          >
            {t("Preview the form")}
          </Link>
        </section>
      </aside>
      <SheetRoot open={showQr} onOpenChange={setShowQr}>
        {showQr ? (
          <SheetContent
            title={t("Your gate's QR code")}
            side="side"
            className="cq-charcoal"
          >
            <div
              className="mx-auto size-56 rounded-2xl bg-(--cq-surface) p-3 text-(--cq-text-primary)"
              role="img"
              aria-label={t("QR code for your gate")}
              // Our own encoder's SVG, built on the server; no user markup.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          </SheetContent>
        ) : null}
      </SheetRoot>
    </div>
  );
}

export function GateEmpty({ onOpen }: { readonly onOpen?: ReactNode }) {
  const t = useT();

  return (
    <StateBlock
      icon={
        <Lock
          size={ICON_SIZE.prominent}
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
      }
      title={t("You don't have a gate yet")}
      body={t(
        "A gate is a short form on your own link, QR code or website. Founders check their fit with your rules in two minutes, and only those who fit can send.",
      )}
    >
      {onOpen}
    </StateBlock>
  );
}
