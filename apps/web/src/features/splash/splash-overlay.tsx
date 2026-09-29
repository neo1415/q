"use client";

import { useEffect, useRef, useState } from "react";

import { CapitalWordmark } from "./capital-wordmark";
import { createCapitalQSplash, type SplashController } from "./splash-engine";
import {
  SPLASH_DONE_EVENT,
  SPLASH_SEEN_KEY,
  splashWasSkipped,
} from "./splash-policy";

/**
 * The cold-start splash (founder handoff revision 3, 2026-09-29).
 *
 * Shown once per browser session, over whatever page opened, including
 * sign-in: the industry pattern is a launch screen before the first
 * screen, whichever it is. The page underneath loads at the same time;
 * nothing waits on the animation. It leaves when the Q has formed, or at
 * once on a tap, a click or a key. Internal navigation, OAuth returns and
 * public card links never show it (see the boot rule in `splash-policy`).
 * When it leaves it tells the page (Discover starts playing then).
 */
export function SplashOverlay() {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<SplashController | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (element === null || splashWasSkipped()) return;
    let done = false;
    const leave = () => {
      if (done) return;
      done = true;
      try {
        sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
      } catch {
        // Private mode: it may show again next load, which is harmless.
      }
      setLeaving(true);
      window.setTimeout(() => {
        controller.current?.destroy();
        controller.current = null;
        document.documentElement.dataset["splash"] = "off";
        setGone(true);
        window.dispatchEvent(new Event(SPLASH_DONE_EVENT));
      }, 320);
    };
    const theme = document.documentElement.dataset["theme"];
    element.dataset["theme"] =
      theme === "light" || theme === "dark" ? theme : "system";
    controller.current = createCapitalQSplash(element, {
      // The formed Q holds for a beat before it hands over.
      onComplete: () => window.setTimeout(leave, 450),
    });
    const skip = () => leave();
    window.addEventListener("keydown", skip, { once: true });
    element.addEventListener("pointerdown", skip, { once: true });
    return () => {
      window.removeEventListener("keydown", skip);
      element.removeEventListener("pointerdown", skip);
      controller.current?.destroy();
      controller.current = null;
    };
  }, []);

  if (gone) return null;
  return (
    <div
      ref={root}
      className="cq-splash"
      data-leaving={leaving ? "true" : undefined}
      role="img"
      aria-label="Capital Q. Opportunity, intelligently connected."
    >
      <div className="cq-splash-atmosphere" aria-hidden="true" />
      <canvas className="cq-splash-canvas" aria-hidden="true" />
      <div className="cq-splash-lockup">
        <div className="cq-splash-capital" aria-hidden="true">
          <CapitalWordmark />
        </div>
        <svg
          className="cq-splash-mark"
          viewBox="0 0 200 200"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
        >
          {[56, 62, 68, 74, 80].map((r, i) => (
            <circle
              key={r}
              cx="100"
              cy="96"
              r={r}
              strokeWidth={i % 2 === 1 ? 3 : 2}
              strokeDasharray="1 3"
            />
          ))}
          <path d="M123 121 L175 173" strokeWidth="18" strokeDasharray="1 3" />
        </svg>
        <p className="cq-splash-tagline" aria-hidden="true">
          Opportunity, intelligently connected.
        </p>
      </div>
      <div className="cq-splash-foot" aria-hidden="true">
        <span>DISCOVER</span>
        <i />
        <span>CONNECT</span>
        <i />
        <span>BUILD</span>
      </div>
    </div>
  );
}
