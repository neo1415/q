"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * What the person told Capital Q at registration, offered as the form's
 * starting values (owner directive 2026-10-16: "defaults from registration";
 * registration facts are known context and never re-asked).
 *
 * A default is only a starting value in an input: nothing is recorded until
 * the person continues, which is their confirmation, and the ordinary submit
 * path validates and persists it like any typed answer. A saved answer
 * always wins over a default. Text a person typed; never authority.
 */
export type RegistrationDefaults = {
  /** The organisation typed at sign-up, for the journey it was typed for. */
  readonly organisationName: string | null;
};

const NONE: RegistrationDefaults = { organisationName: null };

const RegistrationDefaultsContext = createContext<RegistrationDefaults>(NONE);

export function RegistrationDefaultsProvider({
  value,
  children,
}: {
  readonly value: RegistrationDefaults;
  readonly children: ReactNode;
}) {
  return (
    <RegistrationDefaultsContext value={value}>
      {children}
    </RegistrationDefaultsContext>
  );
}

export function useRegistrationDefaults(): RegistrationDefaults {
  return useContext(RegistrationDefaultsContext);
}
