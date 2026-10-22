"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { MeCapabilitiesDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { ICON_SIZE, ICON_STROKE, Lock } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { gateOf, type Gate } from "./role-words";

/**
 * What the signed-in person may do in their active organisation, read once
 * per request in the app layout (GET /v1/me/capabilities) and handed to
 * client components here. Controls ask `useGate(<capability>)` and are
 * hidden or disabled with a short reason when it is not held.
 *
 * This is presentation, never authorisation: every action still goes
 * through the API, which decides again from its own policy facts.
 */
const CapabilitiesContext = createContext<MeCapabilitiesDto | null>(null);

export function CapabilitiesProvider({
  value,
  children,
}: {
  readonly value: MeCapabilitiesDto | null;
  readonly children: ReactNode;
}) {
  return (
    <CapabilitiesContext.Provider value={value}>
      {children}
    </CapabilitiesContext.Provider>
  );
}

/** The capabilities, or null when they could not be read (nothing is guessed). */
export function useCapabilities(): MeCapabilitiesDto | null {
  return useContext(CapabilitiesContext);
}

export function useGate(capability: string | undefined): Gate {
  return gateOf(useContext(CapabilitiesContext), capability);
}

/** The short reason under a held-back control; nothing when allowed. */
export function GateNote({
  gate,
  id,
  className,
}: {
  readonly gate: Gate;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}) {
  const t = useT();
  if (gate.allowed || gate.reason === null) return null;
  return (
    <p
      id={id}
      className={cx(
        "m-0 flex items-center gap-1.5 text-[13px] text-(--cq-text-secondary)",
        className,
      )}
      data-gate-note
    >
      <Lock
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
        className="shrink-0"
      />
      {t(gate.reason)}
    </p>
  );
}

/**
 * A section header's Edit, held back: it stays where Edit would be, says
 * "Admins only", and carries the full reason for assistive technology.
 */
export function LockedEdit({
  gate,
  className,
}: {
  readonly gate: Gate;
  readonly className?: string | undefined;
}) {
  const t = useT();
  return (
    <span
      className={cx(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2.5 text-[13px] text-(--cq-text-tertiary) lg:min-h-9",
        className,
      )}
      title={gate.reason === null ? undefined : t(gate.reason)}
      data-gated-control
    >
      <Lock
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
      />
      {t("Admins only")}
      {gate.reason === null ? null : (
        <span className="sr-only">. {t(gate.reason)}</span>
      )}
    </span>
  );
}

/**
 * Renders its children only when the capability is held (or unknown).
 * For small inline controls with no room for a reason (a logo's edit
 * badge); the section around them says "Admins only".
 */
export function WhenAllowed({
  capability,
  children,
}: {
  readonly capability: string;
  readonly children: ReactNode;
}) {
  return useGate(capability).allowed ? children : null;
}
