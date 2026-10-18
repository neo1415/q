// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ALL_CRITERION_REASON_CODES } from "@capital-q/gateq/engine";

import {
  PWA_STANDALONE_SCRIPT,
  PWA_START_URL,
  isStandaloneLaunch,
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
import {
  AUTOPLAY,
  GateQLive,
  demoAnswersFor,
  rowsFor,
  verdictFor,
} from "../src/features/landing/gateq-live";
import {
  INTRODUCTIONS,
  REHEARSAL_SCRIPT,
  SIGN_IN_HREF,
  SIGN_UP_HREF,
} from "../src/features/landing/landing-content";
import { LandingPage } from "../src/features/landing/landing-page";
import manifest from "../app/manifest";
import { config as proxyConfig } from "../proxy";

/**
 * The landing page (founder-approved design, 2026-10-04): every section
 * renders on the server, the scenes play only on screen and show their
 * end state under reduced motion, the GateQ check runs the real engine on
 * a fictional policy with no network, and the routing rules hold (the
 * PWA and signed-in people never see the landing; the splash still comes
 * first). Request-level routing is in landing-proxy.test.ts.
 */

// next/font is a build-time transform; in a unit test it is just a class.
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font", variable: "font-var", style: {} }),
}));

// The swarm draws on a canvas jsdom does not have. Its slot reports what
// it was asked to show, which is what the scenes decide.
vi.mock("../src/features/landing/swarm-slot", () => ({
  SwarmSlot: (props: {
    variant: string;
    mode?: string;
    gather?: number;
    reducedMotion: boolean;
  }) => (
    <div
      data-testid={`swarm-${props.variant}`}
      data-mode={props.mode ?? "cloud"}
      data-reduced={String(props.reducedMotion)}
    />
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

function stubMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/** Every observed element is on screen at once. */
function stubOnScreen() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly cb: (entries: { isIntersecting: boolean }[]) => void;
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        this.cb = cb;
      }
      observe() {
        queueMicrotask(() => this.cb([{ isIntersecting: true }]));
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

describe("the landing page renders every section", () => {
  it("in order, with a header, a main landmark and a footer", () => {
    stubMotion(false);
    render(<LandingPage />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      "Everyone keeps their own version.",
      "Say it once.Approve what Q prepares.",
      "Built so you can trust what you see.",
      "Three steps.Q does the reading.",
      "Try GateQ: am I a fit?",
      "Rehearse the callbefore it counts.",
      "Where it leads.",
      "Questions.",
      "Bring the evidence. Q does the rest.",
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Private capital,on evidence.",
    );
  });

  it("routes Get started to sign-up, Sign in to sign-in, Try GateQ to its section", () => {
    stubMotion(false);
    render(<LandingPage />);
    for (const link of screen.getAllByRole("link", { name: "Get started" })) {
      expect(link.getAttribute("href")).toBe(SIGN_UP_HREF);
    }
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe(SIGN_IN_HREF);
    for (const link of screen.getAllByRole("link", { name: "Try GateQ" })) {
      expect(link.getAttribute("href")).toBe("#gateq");
    }
    expect(document.getElementById("gateq")).toBeTruthy();
    expect(document.getElementById("how")).toBeTruthy();
  });

  it("labels every illustration as fictional", () => {
    stubMotion(false);
    render(<LandingPage />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("The Q page. An illustration; names are fictional.");
    expect(text).toContain(
      "An illustration with fictional names, not a live session.",
    );
    expect(text).toContain(
      "An illustration of the rehearsal room. The script is fictional.",
    );
    expect(text).toContain("Demo investor (fictional)");
    expect(text).toContain("Illustrations use fictional names.");
  });

  it("carries the installed-launch fallback before its content", () => {
    stubMotion(false);
    const { container } = render(<LandingPage />);
    const first = container.querySelector(".lp")?.firstElementChild;
    expect(first?.tagName).toBe("SCRIPT");
    expect(first?.innerHTML).toBe(PWA_STANDALONE_SCRIPT);
  });

  it("makes none of the claims we may not make", () => {
    stubMotion(false);
    render(<LandingPage />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/guarantee/i);
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/testimonial/i);
    expect(text).not.toMatch(/raised (through|on|with) capital q/i);
  });

  it("starts the converge scene where its script picks it up", () => {
    stubMotion(false);
    const { container } = render(<LandingPage />);
    const frags = container.querySelectorAll<HTMLElement>(".frag");
    expect(frags).toHaveLength(5);
    for (const f of frags) {
      expect(f.style.transform).toMatch(/^translate\(-50%, ?-50%\)/);
    }
  });
});

describe("reduced motion shows every scene's final state", () => {
  it("the introductions are all sent, the call shows its last exchange, GateQ is filled in", async () => {
    stubMotion(true);
    stubOnScreen();
    const { container } = render(<LandingPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // Handle my seed introductions: every card sent, the done line in.
    const statuses = [...container.querySelectorAll(".acard .status")].map(
      (s) => s.textContent,
    );
    expect(statuses).toEqual(INTRODUCTIONS.map(() => "Sent and recorded"));
    expect(container.querySelector("[data-d1=done]")?.classList).toContain(
      "in",
    );
    expect(screen.getByTestId("swarm-hero").dataset["reduced"]).toBe("true");
    // The rehearsal: the last two lines, no timers.
    const caps = [...container.querySelectorAll(".cap")].map((c) =>
      c.textContent?.replace(/^(You|Q)/, ""),
    );
    expect(caps).toEqual([
      REHEARSAL_SCRIPT[6]?.text,
      REHEARSAL_SCRIPT[7]?.text,
    ]);
    // GateQ: the sample answers applied at once.
    expect(await screen.findByText("Nothing rules you out yet.")).toBeTruthy();
  });

  it("the converge scene is static: the record is shown only past its midpoint", () => {
    stubMotion(true);
    const { container } = render(<LandingPage />);
    const record = container.querySelector<HTMLElement>(".record");
    expect(record?.style.opacity).toBe("0");
  });
});

describe("the scenes play when on screen", () => {
  it("Handle my seed introductions: ask, Q works, three cards, each approved, then done", async () => {
    stubMotion(false);
    stubOnScreen();
    vi.useFakeTimers();
    const { container } = render(<LandingPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const demo = screen.getByTestId("swarm-demo");
    const ask = container.querySelector("[data-d1=ask]");
    expect(ask?.classList).not.toContain("in");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(ask?.classList).toContain("in");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // Q at work: the swarm gathers into its ring, the label says so.
    expect(demo.dataset["mode"]).toBe("working");
    expect(
      within(
        container.querySelector(".qwin-presence") as HTMLElement,
      ).getByText("Preparing introductions"),
    ).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3200);
    });
    expect(container.querySelector("[data-card='0']")?.classList).toContain(
      "open",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(container.querySelector("[data-d1=done]")?.classList).toContain(
      "in",
    );
    expect(
      [...container.querySelectorAll(".acard .status")].map(
        (s) => s.textContent,
      ),
    ).toEqual(INTRODUCTIONS.map(() => "Sent and recorded"));
  });

  it("the rehearsal backchannels while listening and pulses while speaking", async () => {
    stubMotion(false);
    stubOnScreen();
    vi.useFakeTimers();
    const { container } = render(<LandingPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(container.querySelector(".cap")?.textContent).toContain(
      REHEARSAL_SCRIPT[0]?.text,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    const back = container.querySelector(".back");
    expect(back?.textContent).toBe("Mm-hm.");
    expect(back?.classList).toContain("in");
    // On to Q's first question: speaking.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100 + 2300 + 1100 + 2300 + 100);
    });
    expect(screen.getByTestId("swarm-call").dataset["mode"]).toBe("speaking");
  });
});

describe("Try GateQ runs the real engine", () => {
  it("each row is the engine's own criterion result", () => {
    const picked = {
      stage: "seed",
      sector: "betting",
      country: "",
      amount: "5000000",
    };
    const engine = runDemo(demoAnswersFor(picked));
    expect(rowsFor(picked).map((r) => r.status)).toEqual(
      engine.criteria.map((c) => c.status),
    );
    expect(rowsFor(picked).map((r) => r.label)).toEqual(
      DEMO_POLICY.criteria.map((c) => c.label),
    );
    expect(rowsFor(null).every((r) => r.status === null)).toBe(true);
  });

  it("the verdict follows the engine: unknown is open, a required miss is outside policy", () => {
    expect(
      verdictFor(
        rowsFor({
          stage: "seed",
          sector: "payments",
          country: "",
          amount: "1200000",
        }),
      ),
    ).toEqual({
      verdict: "Nothing rules you out yet.",
      sub: "One requirement is still unknown. Unknown means the question is open, not a no.",
    });
    expect(
      verdictFor(
        rowsFor({
          stage: "seed",
          sector: "payments",
          country: "NG",
          amount: "1200000",
        }),
      ).verdict,
    ).toBe("You fit what they publish.");
    expect(verdictFor(rowsFor({ stage: "series_a" })).verdict).toBe(
      "Outside this investor's policy.",
    );
    expect(verdictFor(rowsFor({ stage: "series_a" })).sub).toContain(
      "your stage",
    );
  });

  it("fills in live once, then the visitor takes over, with no request or storage", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    stubMotion(false);
    stubOnScreen();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(
      <div className="gate">
        <GateQLive />
      </div>,
    );
    expect(screen.getByText("Answer a question to begin.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600 + AUTOPLAY.length * 750);
    });
    expect(screen.getByText("Nothing rules you out yet.")).toBeTruthy();
    const pressed = [
      ...container.querySelectorAll('.opt[aria-pressed="true"]'),
    ].map((b) => b.textContent);
    expect(pressed).toEqual(["Seed", "Payments", "Skip", "$1.2M"]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Online betting" }));
    expect(screen.getByText("Outside this investor's policy.")).toBeTruthy();
    const never = [...container.querySelectorAll(".crit li")].find((li) =>
      li.textContent?.includes("Sectors we never back"),
    );
    expect(never?.getAttribute("data-s")).toBe("miss");
    expect(never?.textContent).toContain("Outside policy");
    await user.click(screen.getByRole("button", { name: "Kenya" }));
    const hq = [...container.querySelectorAll(".crit li")].find((li) =>
      li.textContent?.startsWith("Headquarters"),
    );
    expect(hq?.getAttribute("data-s")).toBe("match");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });
});

describe("the GateQ demo runs the real engine on a fictional policy", () => {
  it("parses through the engine's own contract and is labelled fictional", () => {
    expect(DEMO_POLICY.version.status).toBe("PUBLISHED");
    expect(DEMO_POLICY.gateway.name).toBe("Demo Ridge Capital");
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

  it("the standalone fallback catches an installed launch with no flag", () => {
    const mm = (standalone: boolean) => (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    });
    expect(isStandaloneLaunch({ matchMedia: mm(false), navigator: {} })).toBe(
      false,
    );
    expect(isStandaloneLaunch({ matchMedia: mm(true), navigator: {} })).toBe(
      true,
    );
    // iOS Home Screen web apps report it on navigator instead.
    expect(isStandaloneLaunch({ navigator: { standalone: true } })).toBe(true);
    // The inline script is the same rule: it hides the page, then leaves.
    expect(PWA_STANDALONE_SCRIPT).toContain('"(display-mode: standalone)"');
    expect(PWA_STANDALONE_SCRIPT).toContain("navigator.standalone===true");
    expect(PWA_STANDALONE_SCRIPT).toContain('setAttribute("data-pwa","")');
    expect(PWA_STANDALONE_SCRIPT).toContain('location.replace("/welcome")');
  });

  it("the splash still comes first on the landing, in a tab and installed", () => {
    // `/` (with or without ?source=pwa) is a cold entry like any other.
    expect(splashSkippedFor("/", false)).toBe(false);
    // Once seen in this session, it is not replayed by the redirect.
    expect(splashSkippedFor("/", true)).toBe(true);
  });
});

describe("the root page is the landing", () => {
  it("renders the landing, prerendered, instead of redirecting", async () => {
    const page = await import("../app/page");
    expect(page.dynamic).toBe("force-static");
    const element = page.default();
    expect(element.type).toBe(LandingPage);
  });
});
