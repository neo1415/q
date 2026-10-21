"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { cx } from "@capital-q/ui";
import { Bell, Check, ICON_SIZE, Newspaper } from "@capital-q/ui/icons";

import { formatDayTime } from "@/components/date-format";
import { workButton } from "@/features/work/work-kit";
import { useT } from "@/features/i18n/language";

import { requestDailyEditionAction, setDailyPreferencesAction } from "./daily-actions";

/**
 * The Q Daily's states (chosen design 2026-10-21, option 3's states in
 * option 1's column): being prepared, none today, none on a picked day,
 * the first edition still to come, turned off. Each says what is true and
 * offers the one thing that helps; none invents an edition or a time.
 */

const REFRESH_MS = 20_000;
const GIVE_UP_MS = 15 * 60_000;

function StateCard({
  icon,
  title,
  children,
  action,
  state,
  spin = false,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly state: string;
  readonly spin?: boolean;
}) {
  return (
    <div
      className="flex min-h-[220px] flex-col items-center justify-center gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-8 text-center sm:min-h-[340px]"
      data-state={state}
      data-qp-anchor="fdr.15.daily.paper"
    >
      <span
        className={cx(
          "grid size-14 place-items-center rounded-2xl bg-(--cq-accent-soft) text-(--cq-accent)",
          spin && "motion-safe:animate-pulse",
        )}
      >
        {icon}
      </span>
      <b className="text-[19px] text-(--cq-text-primary)">{title}</b>
      {children === undefined ? null : (
        <div className="flex max-w-[520px] flex-col items-center gap-2 text-sm text-(--cq-text-secondary)">
          {children}
        </div>
      )}
      {action === undefined ? null : (
        <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}

/** Being prepared: the page reads itself again until it arrives. */
export function DailyPreparing({ latestHref }: { readonly latestHref: string | null }) {
  const t = useT();
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > GIVE_UP_MS) {
        window.clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);
  return (
    <StateCard
      state="preparing"
      spin
      icon={<Newspaper size={26} aria-hidden="true" />}
      title={t("Today’s edition is being prepared")}
      action={
        latestHref === null ? undefined : (
          <Link href={latestHref} className={workButton("secondary")}>
            {t("Read the latest edition")}
          </Link>
        )
      }
    >
      <p role="status" className="m-0" data-daily-preparing>
        {gaveUp
          ? t(
              "Your edition is taking longer than usual. It will appear here and in your email when it's ready.",
            )
          : t("Q is checking its sources. It appears here in a few minutes.")}
      </p>
      <span
        aria-hidden="true"
        className="relative mt-1.5 block h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-(--cq-surface-strong)"
      >
        <span className="absolute inset-y-0 start-0 w-1/3 rounded-full bg-(--cq-accent) motion-safe:animate-[cq-daily-indeterminate_1.6s_ease-in-out_infinite]" />
      </span>
    </StateCard>
  );
}

/** "Get it now": asks for an edition; the server decides if it may. */
export function PrepareNow({
  label = "Get it now",
  variant = "primary",
}: {
  readonly label?: string;
  readonly variant?: "primary" | "secondary";
}) {
  const t = useT();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const prepare = () => {
    setMessage(null);
    startTransition(async () => {
      const outcome = await requestDailyEditionAction();
      if (!outcome.ok) {
        setMessage(outcome.message);
        return;
      }
      switch (outcome.result.status) {
        case "QUEUED":
        case "ALREADY_QUEUED":
          router.refresh();
          return;
        case "TOO_SOON":
          setMessage(
            outcome.result.retryAfter === null
              ? "You have a recent edition. Ask again tomorrow."
              : `You have a recent edition. You can ask for another after ${formatDayTime(outcome.result.retryAfter)}.`,
          );
          return;
        case "OFF":
          setMessage("The Q Daily is off. Turn it on first.");
          return;
      }
    });
  };
  return (
    <span className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={prepare}
        disabled={pending}
        aria-busy={pending}
        className={workButton(variant)}
        data-daily-prepare
      >
        {pending ? t("Starting…") : t(label)}
      </button>
      {message === null ? null : (
        <span role="alert" className="text-xs text-(--cq-text-secondary)">
          {t(message)}
        </span>
      )}
    </span>
  );
}

/** Turned off: one tap turns it on, and the first edition is on its way. */
export function DailyOff() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<"idle" | "on">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const turnOn = () => {
    setMessage(null);
    startTransition(async () => {
      const saved = await setDailyPreferencesAction({ frequency: "DAILY" });
      if (!saved.ok) {
        setMessage(saved.message);
        return;
      }
      setPhase("on");
      router.refresh();
    });
  };
  return (
    <StateCard
      state="off"
      icon={<Bell size={26} aria-hidden="true" />}
      title={t("The Q Daily is off")}
      action={
        <span className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={turnOn}
            disabled={pending || phase === "on"}
            aria-busy={pending}
            className={workButton("primary")}
            data-daily-turn-on
          >
            {phase === "on" ? (
              <>
                <Check size={ICON_SIZE.compact} aria-hidden="true" />
                {t("On")}
              </>
            ) : pending ? (
              t("Turning it on…")
            ) : (
              t("Turn it on")
            )}
          </button>
          {message === null ? null : (
            <span role="alert" className="text-xs text-(--cq-text-secondary)">
              {t(message)}
            </span>
          )}
        </span>
      }
    >
      <p className="m-0">
        {phase === "on"
          ? t("The Q Daily is on. Your first edition is on its way.")
          : t(
              "Turn it on for a short, sourced newspaper about your markets and the people you follow.",
            )}
      </p>
    </StateCard>
  );
}

/** No edition today, with when the next is due and the last one. */
export function DailyNoneToday({
  nextDueAt,
  latest,
  first,
}: {
  readonly nextDueAt: string | null;
  readonly latest: { readonly href: string; readonly day: string } | null;
  /** Nothing has ever been written for them. */
  readonly first: boolean;
}) {
  const t = useT();
  return (
    <StateCard
      state={first ? "empty" : "none-today"}
      icon={<Newspaper size={26} aria-hidden="true" />}
      title={first ? t("Your first edition is on its way") : t("No edition today")}
      action={
        <>
          {latest === null ? null : (
            <Link href={latest.href} className={workButton("secondary")}>
              {t(`Read ${latest.day}’s edition`)}
            </Link>
          )}
          <PrepareNow />
        </>
      }
    >
      <p className="m-0">
        {nextDueAt === null
          ? t("Q writes your next one when it is due.")
          : t(`Your next edition: ${formatDayTime(nextDueAt)}.`)}
      </p>
    </StateCard>
  );
}

/** A picked day without an edition: said, never filled in. */
export function DailyNoneThatDay({
  day,
  nearest,
}: {
  readonly day: string;
  readonly nearest: { readonly href: string; readonly day: string } | null;
}) {
  const t = useT();
  return (
    <StateCard
      state="no-edition"
      icon={<Newspaper size={26} aria-hidden="true" />}
      title={t(`No edition on ${day}`)}
      action={
        nearest === null ? undefined : (
          <Link href={nearest.href} className={workButton("secondary")}>
            {t(`Read ${nearest.day}’s edition`)}
          </Link>
        )
      }
    >
      <p className="m-0">
        {t(
          "Q didn't write one that day: it may have been off, weekly, or before your first edition.",
        )}
      </p>
    </StateCard>
  );
}
