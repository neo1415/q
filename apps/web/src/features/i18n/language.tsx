"use client";

import { useRouter } from "next/navigation";

import { UiTextProvider } from "@capital-q/ui/ui-text";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { QLanguagePreferenceSchema } from "@capital-q/contracts";

import {
  directionOf,
  registerMachineCatalogue,
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

export function announceLanguage(language: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: language }));
}

/**
 * The interface language for everything below it (any language). The
 * wrapper carries `lang` and `dir` in the server HTML, so a right-to-left
 * language renders right to left from the first paint; `display: contents` keeps it out of
 * layout. The document element follows after hydration, so dialogs and
 * popovers portalled to <body> are right-to-left too.
 */
type LanguageValue = {
  readonly language: UiLanguage;
  /**
   * How many machine translations are registered: when more arrive (a new
   * language filling in), every `useT()` reader re-renders with them.
   */
  readonly revision: number;
};
const LanguageContext = createContext<LanguageValue>({
  language: "en",
  revision: 0,
});

/** The machine translations the layout read for this language (complete or not yet). */
export type MachineUiText = {
  readonly entries: Readonly<Record<string, string>>;
  readonly complete: boolean;
};

/** While a new language is still being translated, the screens re-read it this often. */
const MACHINE_REFRESH_MS = 20_000;
const MACHINE_REFRESH_MAX = 15;

export function LanguageProvider({
  language: initial,
  machine,
  children,
}: {
  readonly language: UiLanguage;
  /** Q's machine translations for `language`, when it has no full hand catalogue. */
  readonly machine?: MachineUiText | null | undefined;
  readonly children: ReactNode;
}) {
  // Registered before the first translate below, in render: the words
  // are the same on the server and in the browser, so hydration matches.
  if (machine !== undefined && machine !== null) {
    registerMachineCatalogue(initial, machine.entries);
  }
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
      const detail = QLanguagePreferenceSchema.safeParse(
        (event as CustomEvent<unknown>).detail,
      );
      if (!detail.success) return;
      setAnnounced({
        from: initial,
        to: uiLanguageOf(detail.data, window.navigator.languages),
      });
      // Server-rendered words (Settings, page titles) follow on refresh.
      router.refresh();
    };
    window.addEventListener(LANGUAGE_EVENT, onChange);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, onChange);
    };
  }, [initial, router]);
  // A language still being translated: re-read it now and then (the
  // server translates in the background), never more than a few minutes.
  const translating =
    machine !== undefined && machine !== null && !machine.complete;
  useEffect(() => {
    if (!translating) return;
    let rounds = 0;
    const timer = window.setInterval(() => {
      rounds += 1;
      if (rounds > MACHINE_REFRESH_MAX) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, MACHINE_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [translating, router]);
  const revision =
    machine === undefined || machine === null
      ? 0
      : Object.keys(machine.entries).length;
  const value = useMemo(() => ({ language, revision }), [language, revision]);
  const dir = directionOf(language);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = dir;
  }, [language, dir]);
  return (
    <LanguageContext.Provider value={value}>
      {/* The shared components (@capital-q/ui) read the same catalogue. */}
      <UiTextProvider translate={(english) => translate(language, english)}>
        <div lang={language} dir={dir} className="contents" data-ui-language>
          {children}
        </div>
      </UiTextProvider>
    </LanguageContext.Provider>
  );
}

export function useUiLanguage(): UiLanguage {
  return useContext(LanguageContext).language;
}

/** `t("Settings")`: the string in the interface language. */
export function useT(): (english: string) => string {
  const { language } = useContext(LanguageContext);
  return (english) => translate(language, english);
}

/**
 * `<Words>Not met</Words>`: English words in the reader's language, for a
 * component that cannot take a hook (a server component that is not
 * async). It follows a language change at once, like `useT`.
 */
export function Words({ children }: { readonly children: string }) {
  const t = useT();
  return <>{t(children)}</>;
}
