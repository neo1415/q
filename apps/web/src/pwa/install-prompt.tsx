"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@capital-q/ui/button";

import { useQSessionOptional } from "@/features/q/q-session";
import { useDockAvoid } from "@/features/q-dock/dock-avoid";

import {
  installOffer,
  readDismissed,
  rememberDismissed,
  type InstallOffer,
} from "./install-state";

/** Chromium's install event; not in the DOM lib. */
type BeforeInstallPromptEvent = Event & {
  readonly prompt: () => Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
};

function isBeforeInstallPrompt(
  event: Event,
): event is BeforeInstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isStandalone(): boolean {
  const iosStandalone =
    "standalone" in navigator && navigator.standalone === true;
  return (
    iosStandalone ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches)
  );
}

const noSubscription = () => () => undefined;

/**
 * An unobtrusive offer to install Capital Q: dismissible, remembered on
 * the device for 14 days (see install-state.ts for when it appears). A
 * quiet row in the page's own flow -- never laid over the composer or
 * the welcome (live run 2026-10-28, 390px: it covered both and took the
 * taps until "Got it") -- and a zone the Q Dock moves away from.
 */
export function InstallPrompt() {
  const pathname = usePathname();
  const session = useQSessionOptional();
  const conversing =
    session !== null && (session.turns.length > 0 || session.q.working);
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [closed, setClosed] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      if (!isBeforeInstallPrompt(event)) return;
      // Hold the browser's own prompt until the person asks for it.
      event.preventDefault();
      setDeferred(event);
    };
    const onInstalled = () => {
      rememberDismissed(localStore());
      setClosed(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const offer: InstallOffer =
    !hydrated || closed
      ? "NONE"
      : installOffer({
          standalone: isStandalone(),
          dismissed: readDismissed(localStore()),
          deferredPrompt: deferred !== null,
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints,
          pathname,
          conversing,
        });

  useDockAvoid(ref, offer !== "NONE");

  if (offer === "NONE") return null;

  const dismiss = () => {
    rememberDismissed(localStore());
    setClosed(true);
  };

  const install = async () => {
    if (deferred === null) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    // Whatever they chose, the browser's prompt cannot be shown twice, and
    // the offer is not repeated.
    setDeferred(null);
    dismiss();
  };

  return (
    <section
      ref={ref}
      aria-label="Install Capital Q"
      data-install-prompt={offer}
      className="cq-install-row flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-2"
    >
      <p className="cq-body-sm min-w-0 flex-1 text-(--cq-text-primary)">
        {offer === "PROMPT"
          ? "Install Capital Q to open it from your home screen, full screen."
          : "Add Capital Q to your Home Screen: tap Share, then Add to Home Screen."}
      </p>
      <div className="flex flex-none flex-wrap items-center gap-2">
        {offer === "PROMPT" ? (
          <>
            <Button variant="primary" onClick={() => void install()}>
              Install
            </Button>
            <Button variant="quiet" onClick={dismiss}>
              Not now
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={dismiss}>
            Got it
          </Button>
        )}
      </div>
    </section>
  );
}
