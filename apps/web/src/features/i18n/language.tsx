"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

import { directionOf, translate, type UiLanguage } from "./messages";

/**
 * The interface language for everything below it (multilingual Q). The
 * wrapper carries `lang` and `dir` in the server HTML, so Arabic renders
 * right-to-left from the first paint; `display: contents` keeps it out of
 * layout. The document element follows after hydration, so dialogs and
 * popovers portalled to <body> are right-to-left too.
 */
const LanguageContext = createContext<UiLanguage>("en");

export function LanguageProvider({
  language,
  children,
}: {
  readonly language: UiLanguage;
  readonly children: ReactNode;
}) {
  const dir = directionOf(language);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = dir;
  }, [language, dir]);
  return (
    <LanguageContext.Provider value={language}>
      <div lang={language} dir={dir} className="contents" data-ui-language>
        {children}
      </div>
    </LanguageContext.Provider>
  );
}

export function useUiLanguage(): UiLanguage {
  return useContext(LanguageContext);
}

/** `t("Settings")`: the string in the interface language. */
export function useT(): (english: string) => string {
  const language = useContext(LanguageContext);
  return (english) => translate(language, english);
}
