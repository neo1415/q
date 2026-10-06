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
  LayoutGrid,
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
      <div className="gq-card gq-findbox">
        <label className="gq-label" htmlFor="gq-find">
          Describe the company you&apos;re looking for
        </label>
        <textarea
          id="gq-find"
          className="gq-input"
          value={text}
          maxLength={500}
          placeholder="Seed fintech in Nigeria or Ghana, raising under $2M"
          onChange={(e) => setText(e.target.value)}
        />
        {query.chips.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="cq-caption gq-t2">Q understood:</span>
            {query.chips.map((chip) => (
              <span
                key={`${chip.dimension}-${chip.label}`}
                className="gq-mini"
                style={{ fontSize: 13, padding: "4px 10px" }}
                title={
                  chip.checkable
                    ? undefined
                    : "Companies don't share this with Capital Q yet, so it isn't checked"
                }
              >
                {chip.label}
                {chip.checkable ? "" : " (not checked)"}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={find}
            disabled={pending || text.trim().length < 3}
          >
            <Search {...icon} />
            Find
          </Button>
          <Button
            variant="quiet"
            onClick={() => setText("Climate hardware in East Africa")}
          >
            Try: &ldquo;climate hardware in East Africa&rdquo;
          </Button>
        </div>
      </div>
      {limited ? (
        <div className="gq-banner">
          <Shield {...icon} />
          <span>
            Showing companies open to everyone. Verify your firm to search
            companies that share only with verified investors.
          </span>
        </div>
      ) : null}
      {notice === null ? null : (
        <div className="gq-banner" role="status">
          <Bookmark {...icon} />
          <span>{notice}</span>
        </div>
      )}
      {state === "loading" || pending ? (
        <>
          <div className="flex items-center gap-3 rounded-xl bg-(--cq-surface-subtle) p-3.5">
            <QNavIcon size={22} strokeWidth={2} aria-hidden />
            <span className="cq-body-sm">
              Searching the companies you can see…
            </span>
          </div>
          <Skeleton width="100%" height={70} radius={12} />
          <Skeleton width="100%" height={70} radius={12} />
        </>
      ) : state === "error" || failed ? (
        <ErrorBlock what="Your search" retryHref="/gateq?tab=find" />
      ) : state === "empty" || (results !== null && results.length === 0) ? (
        <StateBlock
          icon={
            <Search
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
          }
          title="No company on Capital Q matches all of that yet"
          body="Save it as an alert and it stays on your Find tab. Or loosen one part of the description."
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
            Save as alert
          </Button>
        </StateBlock>
      ) : results === null ? null : (
        <>
          <div className="gq-sect-h">
            <h2 className="cq-label gq-t2">
              {results.length} compan
              {results.length === 1 ? "y matches" : "ies match"}
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
              Save as alert
            </Button>
          </div>
          <div>
            {results.map((company) => (
              <Link
                key={company.companyId}
                className="gq-resrow"
                href={`/company/${company.companyId}`}
              >
                <span className="gq-logo" style={{ width: 48, height: 48 }}>
                  {company.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <b className="font-semibold">{company.name}</b>
                  {company.oneLiner === null ? null : (
                    <span className="cq-body-sm block">{company.oneLiner}</span>
                  )}
                  <span className="cq-caption gq-t2">
                    {[
                      company.stage === null
                        ? null
                        : (STAGE_WORDS[company.stage] ?? company.stage),
                      company.country,
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </span>
                </span>
                <span className="gq-mini">In your Discover</span>
              </Link>
            ))}
          </div>
        </>
      )}
      <div className="gq-card flex flex-wrap items-center gap-3 p-4">
        <span className="min-w-[220px] flex-1">
          <b className="font-medium">Know a company that isn&apos;t here?</b>
          <span className="cq-body-sm gq-t2 block">
            Send them your gate link. They check their fit in two minutes.
          </span>
        </span>
        <Link
          href="/gateq?tab=gate"
          className={buttonClassName("secondary", "compact")}
        >
          Share your gate
        </Link>
      </div>
    </>
  );
}

const DIMENSION_WORDS: Readonly<Record<string, string>> = {
  TAXONOMY: "Sector",
  EXCLUDED_TAXONOMY: "Never",
  GEOGRAPHY: "Where",
  STAGE: "Stage",
  RAISE_SIZE: "Round size",
  CHEQUE_COMPATIBILITY: "Cheque size",
};

const MODE_WORDS: readonly (readonly [string, string])[] = [
  ["CLOSED", "Closed"],
  ["QUALIFIED", "Only companies that meet my rules"],
  ["OPEN", "Anyone"],
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
  const [days, setDays] = useState(
    replyWithinDays === null ? "" : String(replyWithinDays),
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [pending, startTransition] = useTransition();
  if (state === "loading") {
    return (
      <>
        <Skeleton width="100%" height={120} radius={14} />
        <Skeleton width="100%" height={220} radius={14} />
      </>
    );
  }
  if (state === "error")
    return <ErrorBlock what="Your gate" retryHref="/gateq?tab=gate" />;
  const mode =
    state === "empty" ? "CLOSED" : (policy?.version.inboundMode ?? "QUALIFIED");
  const rules = policy?.criteria ?? [];
  return (
    <>
      {canDecide ? null : (
        <div className="gq-banner">
          <Lock {...icon} />
          <span>
            Only admins of your firm can change the gate. You can copy and share
            the link.
          </span>
        </div>
      )}
      <section className="gq-card flex flex-col gap-3 p-[18px]">
        <h2 className="cq-title-sm">Who can apply</h2>
        <div className="gq-seg" role="radiogroup" aria-label="Who can apply">
          {MODE_WORDS.map(([value, label]) => (
            <Button
              key={value}
              size="compact"
              variant={value === mode ? "secondary" : "quiet"}
              role="radio"
              aria-checked={value === mode}
              disabled={!canDecide}
              onClick={() => setEditing(true)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="cq-body-sm gq-t2">
          {mode === "CLOSED"
            ? "Your gate is closed. Founders see that you're not taking applications right now."
            : mode === "OPEN"
              ? "Anyone can send. Founders still see your rules and how they stand."
              : "Founders who don't meet a rule see why, and can't send. Unanswered questions never count as a no."}
        </p>
      </section>
      <section className="gq-sect">
        <div className="gq-sect-h">
          <h2 className="cq-title-sm">Your rules</h2>
          <Button
            variant="quiet"
            size="compact"
            disabled={!canDecide}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Done" : "Edit"}
          </Button>
        </div>
        {rules.length === 0 ? (
          <p className="cq-body gq-t2">
            No rules yet: every founder can send. Give Q your mandate and it
            drafts them.
          </p>
        ) : (
          <ul className="gq-hair">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex min-h-12 items-center justify-between gap-3"
              >
                <span className="gq-t2">
                  {DIMENSION_WORDS[rule.config.type] ?? rule.config.type}
                </span>
                <span className="text-right">
                  {rule.label}
                  {rule.requiredness === "REQUIRED" ? (
                    ""
                  ) : (
                    <span className="gq-t3"> · preferred</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {editing && canDecide ? editor : null}
      </section>
      <section className="gq-sect">
        <h2 className="cq-title-sm">Promise to founders</h2>
        {canDecide ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = days.trim() === "" ? null : Number(days);
              if (
                value !== null &&
                (!Number.isInteger(value) || value < 1 || value > 60)
              ) {
                setSaved("Use a number of working days from 1 to 60.");
                return;
              }
              startTransition(async () => {
                const done = await replyPromiseAction(gatewayId, {
                  replyWithinDays: value,
                });
                setSaved(
                  done.ok
                    ? value === null
                      ? "No promise shown."
                      : "Saved. Founders see it before they apply."
                    : done.message,
                );
              });
            }}
          >
            <span className="cq-body">
              We reply to every qualified application within
            </span>
            <input
              className="gq-input"
              style={{ width: 72 }}
              inputMode="numeric"
              aria-label="Working days"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <span className="cq-body">working days.</span>
            <Button size="compact" type="submit" disabled={pending}>
              Save
            </Button>
          </form>
        ) : (
          <p className="cq-body">
            {replyWithinDays === null ? (
              "No reply promise yet."
            ) : (
              <>
                We reply to every qualified application within{" "}
                <b>{replyWithinDays} working days</b>.
              </>
            )}
          </p>
        )}
        {saved === null ? null : (
          <p className="cq-caption gq-t2" role="status">
            {saved}
          </p>
        )}
      </section>
      <section className="gq-sect">
        <h2 className="cq-title-sm">Share</h2>
        <div className="flex flex-wrap gap-2">
          <CopyLink text={link} label="Copy link" />
          <Button size="compact" onClick={() => setShowQr(true)}>
            <LayoutGrid {...icon} />
            QR code
          </Button>
          <CopyLink text={snippet} label="Website snippet" />
          <Link
            href={link.replace(/^https?:\/\/[^/]+/, "")}
            className={buttonClassName("quiet", "compact")}
            target="_blank"
          >
            Preview the form
          </Link>
        </div>
        <code className="cq-caption block break-all rounded-xl bg-(--cq-surface-subtle) p-3">
          <Copy {...icon} className="mr-1.5 inline" />
          {snippet}
        </code>
      </section>
      <SheetRoot open={showQr} onOpenChange={setShowQr}>
        {showQr ? (
          <SheetContent title="Your gate's QR code" side="side">
            <div
              className="mx-auto size-56 rounded-2xl bg-(--cq-surface) p-3 text-(--cq-text-primary)"
              role="img"
              aria-label="QR code for your gate"
              // Our own encoder's SVG, built on the server; no user markup.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          </SheetContent>
        ) : null}
      </SheetRoot>
    </>
  );
}

export function GateEmpty({ onOpen }: { readonly onOpen?: ReactNode }) {
  return (
    <StateBlock
      icon={
        <Lock
          size={ICON_SIZE.prominent}
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
      }
      title="You don't have a gate yet"
      body="A gate is a short form on your own link, QR code or website. Founders check their fit with your rules in two minutes, and only those who fit can send."
    >
      {onOpen}
    </StateBlock>
  );
}
