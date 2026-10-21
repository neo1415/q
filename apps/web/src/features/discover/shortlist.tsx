"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import {
  FIT_BAND_LABELS,
  type FitBand,
  type FitComparisonDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Check, Search } from "@capital-q/ui/icons";

import {
  comparisonTitle,
  FitComparisonView,
  WhyTheseSheet,
} from "@/features/fit/fit-comparison";
import { fitCompareAction } from "@/features/fit/fit-actions";
import { LogoTile } from "@/features/investors/match-marks";
import {
  CrmSheet,
  CrmToastProvider,
  QRing,
  Tag,
  crmButton,
  useCrmToast,
} from "@/features/relationships/crm-kit";
import {
  TAB_STRIP_CLASS,
  tabClass,
} from "@/features/relationships/hub-navigation";
import { TabCount } from "@/features/relationships/record-parts";
import { useT } from "@/features/i18n/language";

import { recordDecisionAction, undoPassAction } from "./feed/feed-actions";
import type { ShortlistRow, TopState } from "./shortlist-data";

/**
 * Saved, Passed and Compare (app prototype "shortlist", option 1, "Tabs
 * with a compare tray"). Saved is best fit first, private, and never
 * interest; ticking up to three raises a tray with the one next step,
 * Compare side by side. Pass is neutral and optimistic, with Undo; Undo
 * pass brings a company back into Discover from the next page. Q does not
 * choose the order: it is the fit model's, and the sheet says so.
 */

export type ShortlistTab = "SAVED" | "PASSED" | "COMPARE";

const PICK_MAX = 3;
const ROUTES: Readonly<Record<ShortlistTab, string>> = {
  SAVED: "/discover/saved",
  PASSED: "/discover/passed",
  COMPARE: "/discover/saved/compare",
};

export type ShortlistPorts = {
  readonly decide: typeof recordDecisionAction;
  readonly undoPass: typeof undoPassAction;
  readonly compare: typeof fitCompareAction;
};

const LIVE: ShortlistPorts = {
  decide: recordDecisionAction,
  undoPass: undoPassAction,
  compare: fitCompareAction,
};

/** A fresh idempotency key per intended press; a retry reuses it. */
export function newClientEventId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 64);
}

export function Shortlist(props: {
  readonly initialTab: ShortlistTab;
  readonly saved: readonly ShortlistRow[] | null;
  readonly passed: readonly ShortlistRow[] | null;
  readonly top: TopState;
  /** Companies the address asked to compare, already compared. */
  readonly picked?: FitComparisonDto | null | undefined;
  readonly ports?: ShortlistPorts | undefined;
}) {
  return (
    <CrmToastProvider>
      <ShortlistInner {...props} />
    </CrmToastProvider>
  );
}

function BandTag({ band }: { readonly band: FitBand | null }) {
  const t = useT();
  if (band === null) return null;
  return band === "STRONG_FIT" ? (
    <Tag tone="positive" icon={<Check aria-hidden="true" />}>
      {t(FIT_BAND_LABELS[band])}
    </Tag>
  ) : (
    <Tag tone="stone">{t(FIT_BAND_LABELS[band])}</Tag>
  );
}

function Rank({ n }: { readonly n: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-[26px] flex-none place-items-center rounded-full bg-[var(--cq-tile,var(--cq-text-primary))] text-[13px] font-semibold text-[var(--cq-on-tile,var(--cq-text-inverse))]"
    >
      {n}
    </span>
  );
}

function ShortlistInner({
  initialTab,
  saved,
  passed,
  top,
  picked = null,
  ports = LIVE,
}: {
  readonly initialTab: ShortlistTab;
  readonly saved: readonly ShortlistRow[] | null;
  readonly passed: readonly ShortlistRow[] | null;
  readonly top: TopState;
  readonly picked?: FitComparisonDto | null | undefined;
  readonly ports?: ShortlistPorts | undefined;
}) {
  const t = useT();
  const toast = useCrmToast();
  const [tab, setTab] = useState<ShortlistTab>(initialTab);
  const [savedRows, setSavedRows] = useState(saved ?? []);
  const [passedRows, setPassedRows] = useState(passed ?? []);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [comparison, setComparison] = useState<FitComparisonDto | null>(picked);
  const [comparing, setComparing] = useState(false);
  const [why, setWhy] = useState(false);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [undone, setUndone] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const keyFor = (intent: string, companyId: string) => {
    const at = `${intent}:${companyId}`;
    const known = keys.current.get(at);
    if (known !== undefined) return known;
    const fresh = newClientEventId(intent.toLowerCase());
    keys.current.set(at, fresh);
    return fresh;
  };
  const done = (intent: string, companyId: string) =>
    keys.current.delete(`${intent}:${companyId}`);

  const go = (next: ShortlistTab) => {
    setTab(next);
    setNotice(null);
    if (next !== "COMPARE" || comparison === null) setSelected([]);
    if (next === "COMPARE" && selected.length === 0) setComparison(picked);
    window.history.replaceState(window.history.state, "", ROUTES[next]);
  };

  const toggle = (companyId: string) => {
    if (selected.includes(companyId)) {
      setSelected(selected.filter((id) => id !== companyId));
      return;
    }
    if (selected.length >= PICK_MAX) {
      toast(t("Compare up to three at once"));
      return;
    }
    setSelected([...selected, companyId]);
  };

  const compareNow = async () => {
    if (selected.length < 2) return;
    setComparing(true);
    const found = await ports.compare(selected).catch(() => null);
    setComparing(false);
    if (found === null) {
      toast(t("The comparison didn't load. Try again."));
      return;
    }
    setComparison(found);
    setTab("COMPARE");
    window.history.replaceState(
      window.history.state,
      "",
      `${ROUTES.COMPARE}?ids=${selected.map(encodeURIComponent).join(",")}`,
    );
  };

  /** Pass from Saved: optimistic; it moves to Passed, with Undo. */
  const pass = async (row: ShortlistRow) => {
    setSelected((current) => current.filter((id) => id !== row.companyId));
    setLeaving((current) => new Set([...current, row.companyId]));
    setTimeout(() => {
      setSavedRows((rows) => rows.filter((r) => r.companyId !== row.companyId));
      setPassedRows((rows) => [
        row,
        ...rows.filter((r) => r.companyId !== row.companyId),
      ]);
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(row.companyId);
        return next;
      });
    }, 220);
    toast(t("Passed. It moves to Passed."));
    const passed = await ports
      .decide({
        companyId: row.companyId,
        intent: "PASS",
        slateId: null,
        clientEventId: keyFor("PASS", row.companyId),
        surface: "SAVED_LIST",
      })
      .catch(() => null);
    const unsaved =
      passed?.ok === true
        ? await ports
            .decide({
              companyId: row.companyId,
              intent: "UNSAVE",
              slateId: null,
              clientEventId: keyFor("UNSAVE", row.companyId),
              surface: "SAVED_LIST",
            })
            .catch(() => null)
        : null;
    if (passed?.ok === true && unsaved?.ok === true) {
      done("PASS", row.companyId);
      done("UNSAVE", row.companyId);
      return;
    }
    // Not recorded: put it back where it was, and say so.
    setPassedRows((rows) => rows.filter((r) => r.companyId !== row.companyId));
    setSavedRows((rows) =>
      rows.some((r) => r.companyId === row.companyId) ? rows : [...rows, row],
    );
    setNotice(t("That pass didn't save. Try again."));
  };

  const undoPass = async (row: ShortlistRow) => {
    setUndone((current) => new Set([...current, row.companyId]));
    const result = await ports
      .undoPass({
        companyId: row.companyId,
        clientEventId: keyFor("UNPASS", row.companyId),
      })
      .catch(() => null);
    if (result?.ok === true) {
      done("UNPASS", row.companyId);
      return;
    }
    setUndone((current) => {
      const next = new Set(current);
      next.delete(row.companyId);
      return next;
    });
    setNotice(result?.message ?? t("That did not go through. Try again."));
  };

  const topComparison = top.kind === "READY" ? top.comparison : null;
  const shown = comparison ?? topComparison;

  return (
    <div className="flex flex-col" data-shortlist={tab}>
      <nav aria-label={t("Saved")} className={cx(TAB_STRIP_CLASS, "mb-5")}>
        {(
          [
            ["SAVED", t("Saved"), savedRows.length],
            ["PASSED", t("Passed"), 0],
            ["COMPARE", t("Compare"), 0],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? "page" : undefined}
            className={tabClass(tab === key)}
            onClick={() => go(key)}
            data-shortlist-tab={key}
          >
            {label}
            {count > 0 ? <TabCount>{count}</TabCount> : null}
          </button>
        ))}
      </nav>
      {notice === null ? null : (
        <p role="alert" className="cq-body-sm mb-3 text-(--cq-text-primary)">
          {notice}
        </p>
      )}

      <div key={tab} className="cq-crm-swap">
        {tab === "SAVED" ? (
          saved === null ? (
            <Empty
              title={t("Saved couldn't load.")}
              body={t(
                "Nothing is lost. Capital Q didn't answer just now; try again in a moment.",
              )}
            />
          ) : (
            <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    {t(
                      "Best fit first. Saving isn’t interest, and viewing counts for nothing here.",
                    )}
                  </span>
                  <button
                    type="button"
                    className={crmButton("quiet", "max-lg:hidden")}
                    onClick={() => setWhy(true)}
                  >
                    <QRing />
                    {t("How this is ordered")}
                  </button>
                </div>
                {savedRows.length === 0 ? (
                  <Empty
                    title={t("Nothing saved yet.")}
                    body={t(
                      "Save a company in Discover and it stays here, across visits and devices.",
                    )}
                    action={
                      <Link href="/discover" className={crmButton("secondary")}>
                        {t("Go to Discover")}
                      </Link>
                    }
                  />
                ) : (
                  <ul className="cq-crm-stagger flex flex-col gap-2">
                    {savedRows.map((row) => {
                      const on = selected.includes(row.companyId);
                      return (
                        <li
                          key={row.companyId}
                          className={cx(
                            "grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3.5 rounded-(--cq-radius-lg) border bg-(--cq-surface-raised) px-3.5 py-3 transition-[opacity,transform,border-color,box-shadow] duration-200 ease-(--cq-ease) lg:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]",
                            on
                              ? "border-(--cq-text-secondary) shadow-[0_0_0_3px_var(--cq-accent-soft)] outline-2 -outline-offset-2 outline-(--cq-accent)"
                              : "border-(--cq-border-subtle)",
                            leaving.has(row.companyId) &&
                              "translate-x-4 opacity-0",
                          )}
                          data-saved-company={row.companyId}
                        >
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            aria-label={`${t("Select")} ${row.name} ${t("to compare")}`}
                            onClick={() => toggle(row.companyId)}
                            className="grid size-11 place-items-center"
                            data-pick={row.companyId}
                          >
                            <span
                              aria-hidden="true"
                              className={cx(
                                "grid size-6 place-items-center rounded-[6px] border-[1.5px] transition-colors duration-(--cq-motion-fast)",
                                on
                                  ? "border-[var(--cq-tile,var(--cq-text-primary))] bg-[var(--cq-tile,var(--cq-text-primary))] text-[var(--cq-on-tile,var(--cq-text-inverse))]"
                                  : "border-(--cq-border) bg-(--cq-surface-raised) text-transparent",
                              )}
                            >
                              <Check size={13} strokeWidth={2.6} />
                            </span>
                          </button>
                          <LogoTile
                            kind="company"
                            name={row.name}
                            companyId={row.companyId}
                          />
                          <span className="min-w-0">
                            <b className="block text-[15px] font-semibold text-(--cq-text-primary)">
                              {row.name}
                            </b>
                            <span className="text-[13px] text-(--cq-text-secondary)">
                              {[row.description, row.facts]
                                .filter((part): part is string => part !== null)
                                .join(". ")}
                            </span>
                          </span>
                          <span className="max-lg:hidden">
                            <BandTag band={row.band} />
                          </span>
                          <span className="col-span-full flex gap-2 lg:col-span-1">
                            <Link
                              href={`/company/${encodeURIComponent(row.companyId)}`}
                              className={crmButton(
                                "secondary",
                                "max-lg:flex-1",
                              )}
                            >
                              {t("Open profile")}
                            </Link>
                            <button
                              type="button"
                              className={crmButton("quiet", "max-lg:flex-1")}
                              onClick={() => void pass(row)}
                              data-pass={row.companyId}
                            >
                              {t("Pass")}
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <aside className="flex flex-col gap-3.5 max-lg:hidden">
                <section className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]">
                  <h2 className="text-[13px] font-medium text-(--cq-text-secondary)">
                    {t("Your top three right now")}
                  </h2>
                  <TopList t={t} top={top} />
                  {topComparison === null ? null : (
                    <button
                      type="button"
                      className={crmButton("secondary", "self-start")}
                      onClick={() => setWhy(true)}
                    >
                      {t("Why these three?")}
                    </button>
                  )}
                </section>
                <section className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]">
                  <h2 className="text-[13px] font-medium text-(--cq-text-secondary)">
                    {t("Saved is private")}
                  </h2>
                  <p className="text-sm leading-normal text-(--cq-text-secondary)">
                    {t(
                      "No founder is told you saved them. To reach out, express interest from their profile.",
                    )}
                  </p>
                </section>
              </aside>
            </div>
          )
        ) : tab === "PASSED" ? (
          passed === null ? (
            <Empty
              title={t("Passed couldn't load.")}
              body={t(
                "Nothing is lost. Capital Q didn't answer just now; try again in a moment.",
              )}
            />
          ) : (
            <div className="flex flex-col">
              <p className="mb-3 text-sm text-(--cq-text-secondary)">
                {t(
                  "Passed companies leave your Discover. Undo a pass and it is back in Discover from your next page.",
                )}
              </p>
              {passedRows.length === 0 ? (
                <Empty
                  title={t("Nothing passed.")}
                  body={t(
                    "Companies you pass on in Discover are listed here, so you can bring any of them back.",
                  )}
                />
              ) : (
                <ul className="cq-crm-stagger flex flex-col gap-2">
                  {passedRows.map((row) => (
                    <li
                      key={row.companyId}
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-3.5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                      data-passed-company={row.companyId}
                    >
                      <LogoTile
                        kind="company"
                        name={row.name}
                        companyId={row.companyId}
                      />
                      <span className="min-w-0">
                        <b className="block text-[15px] font-semibold text-(--cq-text-primary)">
                          {row.name}
                        </b>
                        <span className="text-[13px] text-(--cq-text-secondary)">
                          {[row.description, row.facts]
                            .filter((part): part is string => part !== null)
                            .join(". ")}
                        </span>
                      </span>
                      <span className="col-span-full sm:col-span-1">
                        {undone.has(row.companyId) ? (
                          <span className="cq-crm-swap">
                            <Tag
                              tone="positive"
                              icon={<Check aria-hidden="true" />}
                            >
                              {t("Back in Discover from your next page")}
                            </Tag>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={crmButton("secondary", "max-sm:w-full")}
                            onClick={() => void undoPass(row)}
                          >
                            {t("Undo pass")}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
                {comparison === null
                  ? t(comparisonTitle(topComparison?.entries.length ?? 3))
                  : `${t("Comparing")} ${String(comparison.entries.length)}`}
              </h2>
              {shown === null ? null : (
                <button
                  type="button"
                  className={crmButton("quiet")}
                  onClick={() => setWhy(true)}
                >
                  {comparison === null
                    ? t("Why these three?")
                    : t("How this is read")}
                </button>
              )}
            </div>
            {shown === null ? (
              <Empty
                title={
                  top.kind === "NO_MANDATE"
                    ? t("There is nothing to rank against yet.")
                    : t("The comparison didn't load.")
                }
                body={
                  top.kind === "NO_MANDATE"
                    ? t(
                        "Add a mandate and Q ranks your companies by fit with it.",
                      )
                    : t("Nothing is lost. Try again in a moment.")
                }
              />
            ) : shown.entries.length === 0 ? (
              <Empty
                title={t("None of these can be compared on fit right now.")}
                body={t(
                  "You may have no active mandate, or these companies are no longer visible to you.",
                )}
              />
            ) : (
              <FitComparisonView comparison={shown} />
            )}
          </div>
        )}
      </div>

      <div
        className={cx(
          "fixed bottom-[74px] inset-x-3 z-(--cq-z-sticky) flex items-center gap-3.5 rounded-[14px] bg-[var(--cq-tile,var(--cq-text-primary))] py-2.5 ps-[18px] pe-2.5 text-[var(--cq-on-tile,var(--cq-text-inverse))] shadow-(--cq-shadow-overlay) transition-transform duration-300 ease-(--cq-ease) motion-reduce:transition-none lg:inset-x-auto lg:bottom-6 lg:start-1/2 lg:-translate-x-1/2 lg:whitespace-nowrap rtl:lg:translate-x-1/2",
          tab === "SAVED" && selected.length > 0
            ? "translate-y-0"
            : "pointer-events-none translate-y-[160%] lg:translate-y-[140%]",
        )}
        aria-hidden={!(tab === "SAVED" && selected.length > 0)}
        data-compare-tray
      >
        <span className="flex-1 text-sm" aria-live="polite">
          {String(selected.length)} {t("selected")}
        </span>
        <button
          type="button"
          className="cq-crm-press inline-flex min-h-11 items-center justify-center rounded-(--cq-radius-md) bg-(--cq-accent) px-4 text-sm font-medium text-(--cq-text-inverse) hover:bg-(--cq-accent-hover) disabled:opacity-60"
          disabled={selected.length < 2 || comparing}
          onClick={() => void compareNow()}
          data-compare-go
        >
          {comparing
            ? t("Comparing…")
            : selected.length < 2
              ? t("Pick one more to compare")
              : t("Compare side by side")}
        </button>
      </div>

      {shown === null ? (
        <CrmSheet
          open={why}
          onOpenChange={setWhy}
          title={t("Why these three?")}
          sub={t("Q does not choose")}
        >
          <WhyWords t={t} />
        </CrmSheet>
      ) : (
        <WhyTheseSheet comparison={shown} open={why} onOpenChange={setWhy} />
      )}
    </div>
  );
}

function WhyWords({ t }: { readonly t: (english: string) => string }) {
  return (
    <>
      <p className="text-[15px] leading-[1.55] text-(--cq-text-primary)">
        {t(
          "The order is the fit model’s: band first, then confidence, then how many parts are strong. Q only lays it out. Nothing you watched or skipped changes it.",
        )}
      </p>
      <p className="text-sm text-(--cq-text-secondary)">
        {t(
          "Stated by founder means the figure is the founders’ claim and has not been checked.",
        )}
      </p>
    </>
  );
}

function TopList({
  t,
  top,
}: {
  readonly t: (english: string) => string;
  readonly top: TopState;
}) {
  if (top.kind !== "READY") {
    return (
      <p className="text-sm text-(--cq-text-secondary)">
        {top.kind === "NO_MANDATE"
          ? t("Add a mandate and Q ranks your companies by fit with it.")
          : t("Your top three couldn't load just now.")}
      </p>
    );
  }
  if (top.comparison.entries.length === 0) {
    return (
      <p className="text-sm text-(--cq-text-secondary)">
        {t("Nothing to rank yet. Save companies, or answer requests.")}
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2.5">
      {top.comparison.entries.map((entry) => (
        <li key={entry.companyId} className="flex items-center gap-2.5">
          <Rank n={entry.position} />
          <LogoTile
            kind="company"
            name={entry.name}
            companyId={entry.companyId}
            size={28}
          />
          <Link
            href={`/company/${encodeURIComponent(entry.companyId)}`}
            className="min-w-0 flex-1 truncate text-sm text-(--cq-text-primary) hover:underline"
          >
            {entry.name}
          </Link>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t(FIT_BAND_LABELS[entry.profile.band])}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <div
      className="cq-crm-swap flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-6 py-10 text-center"
      data-state="empty"
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full bg-(--cq-surface-strong) text-(--cq-text-secondary)"
      >
        <Search size={22} />
      </span>
      <b className="text-base text-(--cq-text-primary)">{title}</b>
      <p className="max-w-[44ch] text-sm text-(--cq-text-secondary)">{body}</p>
      {action}
    </div>
  );
}
