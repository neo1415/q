"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { Button, type ButtonVariant } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { ChevronDown, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { Input, Textarea } from "@capital-q/ui/input";
import { SheetContent, SheetRoot, SheetTrigger } from "@capital-q/ui/sheet";

import {
  sendStepUpCodeAction,
  stepUpAction,
  type ConsoleResult,
} from "./console-actions";
import {
  activeConsoleHref,
  consoleGroupsFor,
  type ConsoleCounts,
} from "./console-nav";
import { useT } from "@/features/i18n/language";

/**
 * The console's client pieces: the step-up dialog every sensitive action
 * goes through, the reason dialog every write asks for, and the section
 * tabs. Writes are server actions; the API decides who may make them.
 */

type Guard = (work: () => Promise<ConsoleResult>) => Promise<ConsoleResult>;

const StepUpContext = createContext<Guard | null>(null);

export function StepUpProvider({ children }: { readonly children: ReactNode }) {
  const t = useT();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"PASSWORD" | "CODE">("PASSWORD");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const settle = useRef<((confirmed: boolean) => void) | null>(null);
  const fieldId = useId();

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        settle.current = resolve;
        setPassword("");
        setSent(null);
        setMode("PASSWORD");
        setError(undefined);
        setOpen(true);
      }),
    [],
  );

  const guard = useCallback<Guard>(
    async (work) => {
      const first = await work();
      if (first.ok || first.stepUp !== true) return first;
      if (!(await ask())) return { ok: false, message: "Nothing changed." };
      return work();
    },
    [ask],
  );

  const close = (confirmed: boolean) => {
    setOpen(false);
    settle.current?.(confirmed);
    settle.current = null;
  };

  return (
    <StepUpContext.Provider value={guard}>
      {children}
      <DialogRoot
        open={open}
        onOpenChange={(next) => {
          if (!next) close(false);
        }}
      >
        <DialogContent
          title={t("Confirm it's you")}
          description={t(
            "Sensitive console actions need you to sign in again: your password, or a code sent to your email. It lasts 15 minutes.",
          )}
          actions={
            <>
              <Button variant="quiet" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={pending || password.length === 0}
                onClick={() =>
                  startTransition(async () => {
                    const result = await stepUpAction(
                      mode === "PASSWORD" ? { password } : { code: password },
                    );
                    if (result.ok) close(true);
                    else setError(result.message);
                  })
                }
              >
                {pending ? "Confirming…" : "Confirm"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Input
              id={fieldId}
              label={
                mode === "PASSWORD" ? t("Password") : t("Code from your email")
              }
              type={mode === "PASSWORD" ? "password" : "text"}
              inputMode={mode === "PASSWORD" ? undefined : "numeric"}
              autoComplete={
                mode === "PASSWORD" ? "current-password" : "one-time-code"
              }
              value={password}
              error={error}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === "PASSWORD" ? (
              <Button
                variant="quiet"
                size="compact"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(undefined);
                    const result = await sendStepUpCodeAction();
                    if (result.ok) {
                      setMode("CODE");
                      setPassword("");
                      setSent(result.message ?? null);
                    } else setError(result.message);
                  })
                }
              >
                {t("Email me a code instead")}
              </Button>
            ) : (
              <p
                role="status"
                className="cq-caption text-(--cq-text-secondary)"
              >
                {sent}
              </p>
            )}
          </div>
        </DialogContent>
      </DialogRoot>
    </StepUpContext.Provider>
  );
}

/**
 * The step-up guard itself, for an editor that runs its own writes (the
 * site content editor's autosave, decision 107). Null outside the console.
 */
export function useStepUpGuard(): Guard | null {
  return useContext(StepUpContext);
}

export function useConsoleAction() {
  const guard = useContext(StepUpContext);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ConsoleResult | null>(null);
  const perform = (work: () => Promise<ConsoleResult>, onDone?: () => void) => {
    setResult(null);
    startTransition(async () => {
      const outcome = guard === null ? await work() : await guard(work);
      setResult(outcome);
      if (outcome.ok) {
        onDone?.();
        router.refresh();
      }
    });
  };
  return { perform, pending, result };
}

export function ResultLine({
  result,
}: {
  readonly result: ConsoleResult | null;
}) {
  const t = useT();

  if (result === null || result.message === undefined) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className="cq-caption text-(--cq-text-secondary)"
    >
      {t(result.message)}
    </p>
  );
}

/**
 * A write that needs a stated reason: a button that opens a dialog with the
 * reason field and the confirming button named for the action.
 */
export function ReasonAction({
  label,
  title,
  description,
  confirm,
  variant = "secondary",
  minLength = 3,
  reasonLabel = "Reason",
  disabled = false,
  shortcut,
  wide = false,
  run,
}: {
  readonly label: string;
  /** One letter the queue's keyboard handler presses (design-48). */
  readonly shortcut?: string | undefined;
  /** Fills its share of a decision bar. */
  readonly wide?: boolean | undefined;
  readonly title: string;
  readonly description?: string | undefined;
  readonly confirm: string;
  readonly variant?: ButtonVariant | undefined;
  readonly minLength?: number | undefined;
  readonly reasonLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly run: (reason: string) => Promise<ConsoleResult>;
}) {
  const t = useT();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { perform, pending, result } = useConsoleAction();
  const fieldId = useId();
  const short = reason.trim().length < minLength;
  return (
    <div
      className={`flex flex-col gap-1 ${wide ? "min-w-0 flex-1 items-stretch" : "items-start"}`}
    >
      <Button
        variant={variant}
        size="compact"
        className={wide ? "w-full" : undefined}
        disabled={disabled || pending}
        data-shortcut={shortcut}
        aria-keyshortcuts={shortcut?.toUpperCase()}
        onClick={() => {
          setReason("");
          setOpen(true);
        }}
      >
        {t(label)}
      </Button>
      <ResultLine result={result} />
      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t(title)}
          description={description}
          actions={
            <>
              <Button variant="quiet" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant={variant === "danger" ? "danger" : "primary"}
                disabled={short || pending}
                onClick={() => {
                  setOpen(false);
                  perform(() => run(reason.trim()));
                }}
              >
                {confirm}
              </Button>
            </>
          }
        >
          <Textarea
            id={fieldId}
            label={t(reasonLabel)}
            description={t(
              `At least ${String(minLength)} characters. It is kept in the audit log.`,
            )}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

/**
 * The console's grouped sidebar (admin design 2026-11-19 §3.1). Desktop:
 * a column beside the page. Phone: one "Sections" button opening a sheet.
 * Labels are sentence case; the current page is marked by a bar and a
 * fill, never colour alone. Counts come only from a server total.
 */
export function ConsoleNav({
  permissions,
  counts = null,
}: {
  readonly permissions: readonly string[];
  readonly counts?: ConsoleCounts | null | undefined;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const groups = consoleGroupsFor(permissions);
  const current = activeConsoleHref(
    pathname,
    groups.flatMap((group) => group.sections.map((section) => section.href)),
  );
  const currentLabel = groups
    .flatMap((group) => group.sections)
    .find((section) => section.href === current)?.label;
  const list = (onNavigate?: () => void) => (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div
          key={group.label ?? "top"}
          role={group.label === null ? undefined : "group"}
          aria-label={group.label === null ? undefined : t(group.label)}
        >
          {group.label === null ? null : (
            <span className="block px-3 pb-1 text-xs text-(--cq-text-tertiary)">
              {t(group.label)}
            </span>
          )}
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {group.sections.map((section) => {
              const active = section.href === current;
              const count =
                section.count === undefined || counts === null
                  ? null
                  : counts[section.count];
              return (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onNavigate?.()}
                    className={`cq-body-sm relative flex min-h-11 items-center gap-2 rounded-(--cq-radius-md) px-3 pointer-fine:min-h-9 ${
                      active
                        ? "bg-(--cq-accent-soft) font-medium text-(--cq-text-primary)"
                        : "text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
                    }`}
                  >
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-(--cq-accent)"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">
                      {t(section.label)}
                    </span>
                    {count === null ? null : (
                      <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
                        {count.toLocaleString("en-GB")}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
  return (
    <>
      <nav
        aria-label={t("Console sections")}
        className="hidden lg:block"
        data-console-nav
      >
        {list()}
      </nav>
      <div className="lg:hidden" data-console-nav-phone>
        <SheetRoot open={open} onOpenChange={setOpen}>
          <SheetTrigger>
            <button
              type="button"
              className="cq-body-sm inline-flex min-h-11 items-center gap-2 rounded-(--cq-radius-md) border border-(--cq-border) px-3 text-(--cq-text-primary)"
            >
              {t("Sections")}
              {currentLabel === undefined ? null : (
                <span className="text-(--cq-text-secondary)">
                  · {t(currentLabel)}
                </span>
              )}
              <ChevronDown
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            </button>
          </SheetTrigger>
          <SheetContent title={t("Console sections")}>
            <nav aria-label={t("Console sections")}>
              {list(() => {
                setOpen(false);
              })}
            </nav>
          </SheetContent>
        </SheetRoot>
      </div>
    </>
  );
}
