"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The words this package's components show, in the reader's language
 * (multilingual Q). The package holds no catalogue of its own: the app
 * hands it a translator keyed by the English source, and without one every
 * component reads exactly as before.
 */
export type UiTranslate = (english: string) => string;

const identity: UiTranslate = (english) => english;

const UiTextContext = createContext<UiTranslate>(identity);

export function UiTextProvider({
  translate,
  children,
}: {
  readonly translate: UiTranslate;
  readonly children: ReactNode;
}) {
  return (
    <UiTextContext.Provider value={translate}>
      {children}
    </UiTextContext.Provider>
  );
}

export function useUiText(): UiTranslate {
  return useContext(UiTextContext);
}
