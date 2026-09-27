"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@capital-q/ui/button";

import { useDockAvoid } from "@/features/q-dock";

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
 * An unobtrusive offer to install Capital Q: once, dismissible, remembered
 * on the device (see install-state.ts for when it appears). It sits above
 * the phone's tab bar and registers as a zone the Q Dock moves away from.
 */
export function InstallPrompt() {
  const pathname = usePathname();
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
      className="fixed inset-x-4 bottom-[calc(var(--cq-bottom-nav-height)+var(--cq-safe-bottom)+8px)] z-(--cq-z-toast) mx-auto flex max-w-sm flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-4 lg:right-6 lg:bottom-6 lg:left-auto lg:mx-0"
    >
      <p className="cq-body-sm text-(--cq-text-primary)">
        {offer === "PROMPT"
          ? "Install Capital Q to open it from your home screen, full screen."
          : "Add Capital Q to your Home Screen: tap Share, then Add to Home Screen."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
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
