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
import { Input, Textarea } from "@capital-q/ui/input";

import {
  sendStepUpCodeAction,
  stepUpAction,
  type ConsoleResult,
} from "./console-actions";

/**
 * The console's client pieces: the step-up dialog every sensitive action
 * goes through, the reason dialog every write asks for, and the section
 * tabs. Writes are server actions; the API decides who may make them.
 */

type Guard = (work: () => Promise<ConsoleResult>) => Promise<ConsoleResult>;

const StepUpContext = createContext<Guard | null>(null);

export function StepUpProvider({ children }: { readonly children: ReactNode }) {
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
          title="Confirm it's you"
          description="Sensitive console actions need you to sign in again: your password, or a code sent to your email. It lasts 15 minutes."
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
              label={mode === "PASSWORD" ? "Password" : "Code from your email"}
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
                Email me a code instead
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
  if (result === null || result.message === undefined) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className="cq-caption text-(--cq-text-secondary)"
    >
      {result.message}
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
        {label}
      </Button>
      <ResultLine result={result} />
      <DialogRoot open={open} onOpenChange={setOpen}>
        <DialogContent
          title={title}
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
            label={reasonLabel}
            description={`At least ${String(minLength)} characters. It is kept in the audit log.`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

const SECTIONS: readonly {
  readonly href: string;
  readonly label: string;
  /** Shown to a role holding any of these. */
  readonly permission: string | readonly string[];
}[] = [
  { href: "/admin", label: "Overview", permission: "overview.read" },
  { href: "/admin/accounts", label: "Accounts", permission: "accounts.read" },
  {
    href: "/admin/organisations",
    label: "Organisations",
    permission: "accounts.read",
  },
  {
    href: "/admin/queue",
    label: "Queue",
    permission: ["verification.read", "reviews.read"],
  },
  { href: "/admin/safety", label: "Safety", permission: "safety.read" },
  { href: "/admin/q", label: "Q monitor", permission: "q.monitor.read" },
  { href: "/admin/audit", label: "Audit", permission: "audit.read" },
  { href: "/admin/flags", label: "Kill switches", permission: "flags.read" },
  { href: "/admin/brand", label: "Brand", permission: "flags.write" },
  // BILLING block (ADR 0034)
  { href: "/admin/billing", label: "Billing", permission: "billing.fees.read" },
  { href: "/admin/email", label: "Email", permission: "email.read" },
  { href: "/admin/team", label: "Team", permission: "overview.read" },
];

export function ConsoleNav({
  permissions,
}: {
  readonly permissions: readonly string[];
}) {
  const pathname = usePathname();
  const allowed = SECTIONS.filter((section) =>
    typeof section.permission === "string"
      ? permissions.includes(section.permission)
      : section.permission.some((one) => permissions.includes(one)),
  );
  return (
    <nav
      aria-label="Console sections"
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex gap-1 border-b border-(--cq-border-subtle)">
        {allowed.map((section) => {
          const active =
            section.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`cq-body-sm inline-flex min-h-11 items-center px-3 whitespace-nowrap border-b-2 ${
                  active
                    ? "border-(--cq-text-primary) text-(--cq-text-primary)"
                    : "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
                }`}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
