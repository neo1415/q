// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALL_CRITERION_REASON_CODES } from "@capital-q/gateq/engine";

import {
  PWA_STANDALONE_SCRIPT,
  PWA_START_URL,
  landingRedirect,
} from "../src/auth/landing-route";
import { splashSkippedFor } from "../src/features/splash/splash-policy";
import {
  DEMO_POLICY,
  DEMO_PUBLIC_GATEWAY,
  EMPTY_ANSWERS,
  REASON_COPY,
  normaliseAmount,
  runDemo,
  type DemoAnswers,
} from "../src/features/landing/gateq-demo";
import * as COPY from "../src/features/landing/landing-copy";
import manifest from "../app/manifest";
import { config as proxyConfig } from "../proxy";

/**
 * The landing page (2026-10-05 demo): StoryBrand sections, the claims we
 * may make and none we may not, the GateQ demo on the real engine with no
 * network, Watch Q work under reduced motion, and the routing rules (the
 * PWA never sees the landing; the splash still comes first).
 */

// The swarm draws on a canvas jsdom does not have; its own tests cover it.
vi.mock("../src/features/q-aperture/q-aperture", () => ({
  QAperture: ({ state }: { state: string }) => (
    <div data-testid="q-aperture" data-state={state} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function answers(overrides: Partial<DemoAnswers>): DemoAnswers {
  return { ...EMPTY_ANSWERS, ...overrides };
}

describe("the landing page renders every StoryBrand section", () => {
  const SECTIONS = [
    "Hero",
    "Problem",
    "Guide",
    "Plan",
    "Watch Q work",
    "Try GateQ",
    "Success",
    "Failure avoided",
    "Rehearsal",
    "FAQ",
    "Get started",
  ];

  async function renderLanding() {
    const { LandingPage } =
      await import("../src/features/landing/landing-page");
    render(<LandingPage />);
    await act(async () => {});
  }

  it("in StoryBrand order, with a header, a main landmark and a footer", async () => {
    await renderLanding();
    const order = [
      ...document.querySelectorAll<HTMLElement>("[data-landing-section]"),
    ].map((s) => s.dataset["landingSection"]);
    expect(order).toEqual(SECTIONS);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: COPY.HERO.title }),
    ).toBeTruthy();
  });

  it("shows the five defensible claims, numbered", async () => {
    await renderLanding();
    const guide = document.querySelector<HTMLElement>(
      '[data-landing-section="Guide"]',
    );
    expect(guide).not.toBeNull();
    for (const claim of COPY.GUIDE.claims) {
      expect(
        within(guide as HTMLElement).getByRole("heading", {
          name: claim.title,
        }),
      ).toBeTruthy();
    }
    expect(COPY.GUIDE.claims).toHaveLength(5);
  });

  it("routes the direct CTA to sign-up and the transitional CTAs to their sections", async () => {
    await renderLanding();
    const direct = document.querySelectorAll<HTMLAnchorElement>(
      '[data-cta="direct"]',
    );
    expect(direct.length).toBeGreaterThanOrEqual(2);
    for (const link of direct) {
      expect(link.getAttribute("href")).toBe("/auth/sign-up");
    }
    const transitional = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        '[data-cta="transitional"]',
      ),
    ].map((a) => a.getAttribute("href"));
    expect(transitional).toEqual([
      `#${COPY.GATEQ_ANCHOR}`,
      `#${COPY.WATCH_ANCHOR}`,
    ]);
    expect(document.getElementById(COPY.GATEQ_ANCHOR)).not.toBeNull();
    expect(document.getElementById(COPY.WATCH_ANCHOR)).not.toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Sign in" })[0]?.getAttribute("href"),
    ).toBe("/auth/sign-in");
  });

  it("carries the installed-launch fallback before its content", async () => {
    await renderLanding();
    const first = document.querySelector(".cq-landing")?.firstElementChild;
    expect(first?.tagName).toBe("SCRIPT");
    expect(first?.innerHTML).toBe(PWA_STANDALONE_SCRIPT);
  });

  it("makes none of the claims we may not make", async () => {
    await renderLanding();
    const text = `${document.body.textContent ?? ""} ${JSON.stringify(COPY)}`;
    expect(text).not.toMatch(/verified identit/i);
    expect(text).not.toMatch(/fraud[- ]proof/i);
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\bx faster|times faster/i);
    expect(text).not.toMatch(/raised (through|on|with) capital q/i);
    expect(text).not.toMatch(/testimonial/i);
  });
});

describe("the GateQ demo runs the real engine on a fictional policy", () => {
  it("parses through the engine's own contract and is labelled fictional", () => {
    expect(DEMO_POLICY.version.status).toBe("PUBLISHED");
    expect(COPY.GATEQ.privacy).toMatch(/nothing you enter is sent or saved/i);
  });

  it("publishes labels, never the configured answers", () => {
    const projection = JSON.stringify(DEMO_PUBLIC_GATEWAY);
    expect(projection).not.toMatch(
      /"NG"|pre_seed|250000|00000000-0000-4000-8000-0000000001/,
    );
    expect(DEMO_PUBLIC_GATEWAY?.criteria.map((c) => c.label)).toContain(
      "Stage",
    );
  });

  it("matched: a seed payments company in Lagos raising $1.2M qualifies", () => {
    const result = runDemo(
      answers({
        stage: "seed",
        sector: "payments",
        country: "NG",
        amount: "1,200,000",
      }),
    );
    expect(result.outcome).toBe("QUALIFIED");
    expect(result.access).toBe("MAY_APPLY");
    expect(result.criteria.every((c) => c.status === "MATCH")).toBe(true);
    // Payments sits under fintech: the hierarchy, not a string compare.
    expect(result.criteria.find((c) => c.type === "TAXONOMY")?.reasonCode).toBe(
      "TAXONOMY_ANCESTOR_MATCHED",
    );
  });

  it("unknown: skipping everything is unknown, never a no", () => {
    const result = runDemo(EMPTY_ANSWERS);
    expect(result.outcome).toBe("INSUFFICIENT_INFORMATION");
    expect(result.access).toBe("NEEDS_INFORMATION");
    expect(result.criteria.every((c) => c.status === "UNKNOWN")).toBe(true);
    expect(result.principalMismatches).toEqual([]);
    expect(
      result.criteria.find((c) => c.type === "EXCLUDED_TAXONOMY")?.reasonCode,
    ).toBe("EXCLUSION_NOT_ASSESSABLE");
  });

  it("unknown: a round in another currency is never converted", () => {
    const result = runDemo(
      answers({
        stage: "seed",
        sector: "climate",
        country: "KE",
        amount: "900000",
        currency: "GBP",
      }),
    );
    const raise = result.criteria.find((c) => c.type === "RAISE_SIZE");
    expect(raise?.status).toBe("UNKNOWN");
    expect(raise?.reasonCode).toBe("RAISE_CURRENCY_DIFFERS");
    expect(result.outcome).toBe("INSUFFICIENT_INFORMATION");
  });

  it("not matched: a Series B is outside the stages, and an excluded sector refuses", () => {
    const late = runDemo(
      answers({
        stage: "series_b",
        sector: "payments",
        country: "NG",
        amount: "1200000",
      }),
    );
    expect(late.outcome).toBe("NOT_QUALIFIED");
    expect(late.access).toBe("MAY_NOT_APPLY");
    expect(late.criteria.find((c) => c.type === "STAGE")?.reasonCode).toBe(
      "STAGE_NOT_ALLOWED",
    );

    const betting = runDemo(answers({ sector: "betting" }));
    expect(betting.outcome).toBe("NOT_QUALIFIED");
    expect(
      betting.criteria.find((c) => c.type === "EXCLUDED_TAXONOMY")?.reasonCode,
    ).toBe("EXCLUSION_MATCHED");
  });

  it("a preferred criterion reports and never gates", () => {
    const small = runDemo(
      answers({
        stage: "seed",
        sector: "payments",
        country: "GB",
        amount: "100000",
      }),
    );
    const cheque = small.criteria.find(
      (c) => c.type === "CHEQUE_COMPATIBILITY",
    );
    expect(cheque?.status).toBe("NO_MATCH");
    expect(cheque?.requiredness).toBe("PREFERRED");
    // Below the round band, which is required: that is what refuses.
    expect(
      small.criteria.find((c) => c.type === "RAISE_SIZE")?.reasonCode,
    ).toBe("RAISE_BELOW_BAND");
  });

  it("is deterministic and explains every reason the engine can give", () => {
    const input = answers({
      stage: "pre_seed",
      sector: "health",
      country: "US",
    });
    expect(runDemo(input)).toEqual(runDemo(input));
    for (const code of ALL_CRITERION_REASON_CODES) {
      expect(REASON_COPY[code]).toBeTruthy();
    }
  });

  it("reads amounts exactly, never as floats", () => {
    expect(normaliseAmount("1,200,000")).toBe("1200000");
    expect(normaliseAmount("1500000.50")).toBe("1500000.50");
    expect(normaliseAmount("1.2m")).toBeNull();
    expect(normaliseAmount("")).toBeNull();
  });

  it("the form shows the result without a request or any storage", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { GateQDemoForm } =
      await import("../src/features/landing/gateq-demo-form");
    const user = userEvent.setup();
    render(<GateQDemoForm />);
    expect(screen.getByText("Demo investor (fictional)")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Stage"), "seed");
    await user.selectOptions(screen.getByLabelText("Sector"), "payments");
    await user.selectOptions(screen.getByLabelText("Headquarters"), "NG");
    await user.type(screen.getByLabelText("Round size"), "1200000");
    await user.click(screen.getByRole("button", { name: COPY.GATEQ.submit }));
    expect(screen.getByText("You meet every requirement")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: COPY.GATEQ.cta }).getAttribute("href"),
    ).toBe("/auth/sign-up");

    await user.click(screen.getByRole("button", { name: COPY.GATEQ.reset }));
    await user.click(screen.getByRole("button", { name: COPY.GATEQ.submit }));
    expect(screen.getByText("Nothing rules you out yet")).toBeTruthy();
    expect(screen.getAllByText(/· Unknown/).length).toBeGreaterThan(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("refuses a malformed amount with a message rather than guessing", async () => {
    const { GateQDemoForm } =
      await import("../src/features/landing/gateq-demo-form");
    const user = userEvent.setup();
    render(<GateQDemoForm />);
    await user.type(screen.getByLabelText("Round size"), "about a million");
    await user.click(screen.getByRole("button", { name: COPY.GATEQ.submit }));
    expect(screen.getByText(/use digits only/i)).toBeTruthy();
    expect(screen.queryByText("Nothing rules you out yet")).toBeNull();
  });
});

describe("Watch Q work", () => {
  function setReducedMotion(reduce: boolean) {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: reduce && query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it("is labelled as an illustration", async () => {
    setReducedMotion(true);
    const { WatchQWork } = await import("../src/features/landing/watch-q-work");
    render(<WatchQWork />);
    expect(screen.getByText(COPY.WATCH.label)).toBeTruthy();
  });

  it("reduced motion: shows the finished story at once, with no timers", async () => {
    setReducedMotion(true);
    vi.useFakeTimers();
    const { WatchQWork } = await import("../src/features/landing/watch-q-work");
    render(<WatchQWork />);
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(0);
    const steps = document.querySelectorAll(".cq-landing-step");
    expect(steps).toHaveLength(4);
    for (const step of steps)
      expect(step.classList.contains("is-shown")).toBe(true);
    expect(screen.getByTestId("q-aperture").dataset["state"]).toBe("COMPLETE");
  });

  it("plays when on screen: ask, Q prepares, the exact message for approval, then done", async () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    const { WatchQWork } = await import("../src/features/landing/watch-q-work");
    render(<WatchQWork />);
    await act(async () => {});
    const shown = () =>
      document.querySelectorAll(".cq-landing-step.is-shown").length;
    expect(shown()).toBe(0);
    // Every line is laid out from the start, so nothing reflows as it plays.
    expect(screen.getByText(COPY.WATCH.card.body)).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(300));
    expect(shown()).toBe(1);
    await act(async () => vi.advanceTimersByTime(1100 + 1500));
    expect(shown()).toBe(3);
    expect(screen.getByTestId("q-aperture").dataset["state"]).toBe(
      "NEEDS_APPROVAL",
    );
    await act(async () => vi.advanceTimersByTime(2600));
    expect(shown()).toBe(4);
    expect(screen.getByRole("button", { name: "Approved" })).toBeTruthy();
  });

  it("the visitor can tap Approve themselves", async () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    const { WatchQWork } = await import("../src/features/landing/watch-q-work");
    render(<WatchQWork />);
    await act(async () => vi.advanceTimersByTime(300 + 1100 + 1500));
    await act(async () =>
      screen.getByRole("button", { name: COPY.WATCH.card.approve }).click(),
    );
    expect(document.querySelectorAll(".cq-landing-step.is-shown")).toHaveLength(
      4,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("routing: the installed app never shows the landing", () => {
  it("the manifest starts installed launches flagged", () => {
    expect(manifest().start_url).toBe(PWA_START_URL);
    expect(PWA_START_URL).toBe("/?source=pwa");
  });

  it("the proxy runs on exactly the root", () => {
    expect(proxyConfig.matcher).toContain("/");
  });

  it("signed in → the app; installed and signed out → sign-in; otherwise the landing", () => {
    const flag = new URLSearchParams("source=pwa");
    const none = new URLSearchParams();
    expect(landingRedirect({ signedIn: true, searchParams: none })).toBe(
      "/welcome",
    );
    expect(landingRedirect({ signedIn: true, searchParams: flag })).toBe(
      "/welcome",
    );
    // /welcome is sign-in's default return, so it needs no `next`.
    expect(landingRedirect({ signedIn: false, searchParams: flag })).toBe(
      "/auth/sign-in",
    );
    expect(landingRedirect({ signedIn: false, searchParams: none })).toBeNull();
    expect(
      landingRedirect({
        signedIn: false,
        searchParams: new URLSearchParams("source=elsewhere"),
      }),
    ).toBeNull();
  });

  it("the standalone fallback hides the landing only in standalone display mode", () => {
    const run = (standalone: boolean) => {
      document.documentElement.removeAttribute("data-pwa");
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: standalone && query === "(display-mode: standalone)",
      }));
      // jsdom cannot navigate; the script's own try/catch keeps it silent.
      new Function(PWA_STANDALONE_SCRIPT)();
      return document.documentElement.hasAttribute("data-pwa");
    };
    expect(run(false)).toBe(false);
    expect(run(true)).toBe(true);
    document.documentElement.removeAttribute("data-pwa");
  });

  it("the splash still comes first on the landing, in a tab and installed", () => {
    // `/` (with or without ?source=pwa) is a cold entry like any other.
    expect(splashSkippedFor("/", false)).toBe(false);
    // Once seen in this session, it is not replayed by the redirect.
    expect(splashSkippedFor("/", true)).toBe(true);
  });
});
