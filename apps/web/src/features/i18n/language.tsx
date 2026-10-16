"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  directionOf,
  translate,
  uiLanguageOf,
  type UiLanguage,
} from "./messages";

/**
 * The window event a language change is announced on (the person told Q,
 * or chose it in Settings): every provider and the voice line follow it
 * at once, without a reload. The choice is already saved by the server.
 */
export const LANGUAGE_EVENT = "cq:language";

export function announceLanguage(language: "AUTO" | "en" | "ar"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: language }));
}

/**
 * The interface language for everything below it (multilingual Q). The
 * wrapper carries `lang` and `dir` in the server HTML, so Arabic renders
 * right-to-left from the first paint; `display: contents` keeps it out of
 * layout. The document element follows after hydration, so dialogs and
 * popovers portalled to <body> are right-to-left too.
 */
const LanguageContext = createContext<UiLanguage>("en");

export function LanguageProvider({
  language: initial,
  children,
}: {
  readonly language: UiLanguage;
  readonly children: ReactNode;
}) {
  // The server's saved choice, until a change is announced on this tab; a
  // later render from the server (after the refresh below) wins again.
  const [announced, setAnnounced] = useState<{
    readonly from: UiLanguage;
    readonly to: UiLanguage;
  } | null>(null);
  const language =
    announced !== null && announced.from === initial ? announced.to : initial;
  const router = useRouter();
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail !== "AUTO" && detail !== "en" && detail !== "ar") return;
      setAnnounced({ from: initial, to: uiLanguageOf(detail) });
      // Server-rendered words (Settings, page titles) follow on refresh.
      router.refresh();
    };
    window.addEventListener(LANGUAGE_EVENT, onChange);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, onChange);
    };
  }, [initial, router]);
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
