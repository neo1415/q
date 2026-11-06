// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  navigateTargetToIntent,
  type QNavigateTarget,
} from "@capital-q/contracts";

/**
 * Q Workspace W3 (DECISIONS 71): every deep link lands on the exact place
 * -- link → page → the target element in view and marked -- and Back after
 * Q's move returns to the page before it.
 */

type Opened =
  | {
      ok: true;
      value: {
        url: string;
        downloadable: boolean;
        watermark: string | null;
        downloadUrl: string | null;
      };
    }
  | { ok: false; message: string };
const openDocumentAction = vi.fn<(c: string, d: string) => Promise<Opened>>();
let searchParams = new URLSearchParams();

vi.mock("../src/features/company/material/material-actions", () => ({
  openDocumentAction: (c: string, d: string) => openDocumentAction(c, d),
  openDeckAction: vi.fn(),
  requestAccessAction: vi.fn(),
  decideRequestAction: vi.fn(),
  setLevelAction: vi.fn(),
  setOutlineAction: vi.fn(),
  newRequestKey: vi.fn(() => Promise.resolve("dr-key-0001")),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => searchParams,
  usePathname: () => window.location.pathname,
}));

const { recordIntentPath } = await import("../src/features/q/client-actions");
const { pathOfIntent } =
  await import("../src/features/q/control/fast-navigation");
const { arrivalTargetOf, navigateIntentPath, withNavigateTarget } =
  await import("../src/features/q/control/deep-link");
const { arrive, ARRIVAL_MARK, markQMove, qMoveOrigin } =
  await import("../src/features/q/control/arrival");
const { QArrival } = await import("../src/features/q/control/q-arrival");
const { requestNavigation, onNavigationOutcome } =
  await import("../src/features/q/control/navigation-lifecycle");
const { registerClientRouter } =
  await import("../src/features/q/control/router-registry");
const { noteRoute, resetUiActController } =
  await import("../src/features/q/ui-act-controller");
const { resetAppRoutes } = await import("../src/features/q/control/app-routes");
const { InvestorDataRoom } =
  await import("../src/features/company/material/data-room");
const { slideParam } = await import("../src/features/company/brief/deck-tab");
const fixtures =
  await import("../src/features/company/material/review-fixtures");

const COMPANY = "d48c26d2-5aca-4788-9033-073b0f9d08ec";
const DOC = "0f0e7f5c-6d9e-4a49-9b8c-0a3c1f1b2c3d";
const MESSAGE = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ITEM = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

/** The path a target goes to: contract → intent → the browser's route map. */
function pathOf(target: QNavigateTarget): string | null {
  const intent = navigateTargetToIntent(target);
  return intent.kind === "NAVIGATE"
    ? navigateIntentPath(intent)
    : recordIntentPath(intent);
}

let scrolled: { element: Element; options: unknown }[] = [];
let reduced = false;

beforeEach(() => {
  scrolled = [];
  reduced = false;
  searchParams = new URLSearchParams();
  openDocumentAction.mockReset();
  Element.prototype.scrollIntoView = function (options?: unknown) {
    scrolled.push({ element: this, options });
  };
  // jsdom lays nothing out; anything rendered has a box, except a
  // `display: contents` QSection marker (as in a browser).
  Element.prototype.getClientRects = function (this: Element) {
    const contents =
      this instanceof HTMLElement && this.className.includes("contents");
    return (contents ? [] : [{}]) as unknown as DOMRectList;
  };
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, "", "/home");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("W3.2 every deep link's path", () => {
  it.each([
    [
      { page: "COMPANY", recordId: COMPANY, tab: "dataroom", documentId: DOC },
      `/company/${COMPANY}?tab=dataroom&doc=${DOC}`,
    ],
    [
      { page: "COMPANY", recordId: COMPANY, tab: "deck", slide: 7 },
      `/company/${COMPANY}?tab=deck&slide=7&open=1`,
    ],
    [
      {
        page: "RELATIONSHIP_COMPANY_MESSAGES",
        recordId: COMPANY,
        tab: "messages",
        messageId: MESSAGE,
      },
      `/relationships/company/${COMPANY}/messages?message=${MESSAGE}`,
    ],
    [
      { page: "INVESTOR", recordId: COMPANY, tab: "looks-for" },
      `/investors/${COMPANY}?tab=looks-for`,
    ],
    [{ page: "BOARD", itemId: ITEM }, `/board?item=${ITEM}`],
    [
      { page: "CAPITAL", sectionId: "rounds", position: "section" },
      "/relationships?view=capital#section-rounds",
    ],
    [
      { page: "PROFILE", sectionId: "mandate", position: "section" },
      "/profile#section-mandate",
    ],
    [
      { page: "CRM_PIPELINE", sectionId: "pipeline" },
      "/relationships?view=pipeline#section-pipeline",
    ],
    [{ page: "CAPITAL" }, "/relationships?view=capital"],
  ] as const)("%o → %s", (target, path) => {
    expect(pathOf(target)).toBe(path);
  });

  it("an offer's or a fast move's path carries the target too", () => {
    expect(
      pathOfIntent({
        kind: "NAVIGATE",
        destination: "BOARD",
        target: { itemId: ITEM },
      }),
    ).toBe(`/board?item=${ITEM}`);
  });

  it("latest lands on the end of a page; a path never leaves the app", () => {
    expect(withNavigateTarget("/board", { position: "latest" })).toBe(
      "/board#latest",
    );
    expect(withNavigateTarget("https://evil.example/x", { itemId: ITEM })).toBe(
      "https://evil.example/x",
    );
  });

  it("reads back only well-formed targets from a URL", () => {
    expect(arrivalTargetOf(`/x?message=${MESSAGE}`)).toEqual({
      kind: "MESSAGE",
      id: MESSAGE,
    });
    expect(arrivalTargetOf('/x?message="]div')).toBeNull();
    expect(arrivalTargetOf("/x#section-Bad Id")).toBeNull();
    expect(arrivalTargetOf("/x#mandate")).toBeNull();
  });
});

/** The page as rendered: Q's composer outside #main, the page inside. */
function page(content: string): void {
  document.body.innerHTML = `
    <textarea aria-label="Ask Q" data-composer></textarea>
    <main id="main"><h1>Page</h1>${content}</main>`;
}

describe("W3.3 arrival: link → page → the target in view", () => {
  it.each([
    [
      `/relationships/company/${COMPANY}/messages?message=${MESSAGE}`,
      `<ol><li data-q-message="${MESSAGE.toUpperCase()}">hi</li></ol>`,
    ],
    [`/board?item=${ITEM}`, `<ul><li data-board-item="${ITEM}">task</li></ul>`],
    [
      "/capital#section-rounds",
      `<div data-q-section="rounds" class="contents"><section>rounds</section></div>`,
    ],
    ["/profile#section-mandate", `<section id="mandate">mandate</section>`],
    // W4's eval vocabulary (feat/q-navigation-policy): once W2 registers
    // these QSection ids, arrival needs nothing more.
    ...["commitments", "deck-views", "missing", "draft"].map(
      (id) =>
        [
          `/somewhere#section-${id}`,
          `<div data-q-section="${id}" class="contents"><section>${id}</section></div>`,
        ] as const,
    ),
    [
      "/relationships/x/messages#latest",
      `<ol><li data-q-message="a">1</li><li data-q-message="b" id="last">2</li></ol>`,
    ],
  ])("%s", async (href, content) => {
    page(content);
    expect(await arrive({ byQ: false, href, waitMs: 200 })).toBe("ARRIVED");
    const [first] = scrolled;
    expect(first?.element.tagName).not.toBe("DIV");
    expect(first?.element.hasAttribute(ARRIVAL_MARK)).toBe(true);
    expect(first?.options).toMatchObject({ behavior: "smooth" });
  });

  it("waits for a page that renders late, and is honest when nothing comes", async () => {
    page("");
    const late = arrive({ byQ: false, href: `/board?item=${ITEM}` });
    setTimeout(() => {
      document
        .getElementById("main")
        ?.insertAdjacentHTML(
          "beforeend",
          `<li data-board-item="${ITEM}"></li>`,
        );
    }, 120);
    expect(await late).toBe("ARRIVED");
    expect(
      await arrive({ byQ: false, href: "/x#section-nope", waitMs: 120 }),
    ).toBe("MISSING");
  });

  it("with reduced motion scrolls at once", async () => {
    reduced = true;
    page(`<li data-board-item="${ITEM}"></li>`);
    await arrive({ byQ: false, href: `/board?item=${ITEM}` });
    expect(scrolled[0]?.options).toMatchObject({ behavior: "auto" });
  });

  it("after Q's move focuses the page heading; the person's own load does not", async () => {
    page(`<li data-board-item="${ITEM}"></li>`);
    await arrive({ byQ: false, href: `/board?item=${ITEM}` });
    expect(document.activeElement?.tagName).not.toBe("H1");
    await arrive({ byQ: true, href: `/board?item=${ITEM}` });
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.querySelector("h1")?.getAttribute("tabindex")).toBe("-1");
  });

  it("leaves the person alone while they type to Q", async () => {
    page(`<li data-board-item="${ITEM}"></li>`);
    document.querySelector<HTMLTextAreaElement>("[data-composer]")?.focus();
    expect(await arrive({ byQ: true, href: `/board?item=${ITEM}` })).toBe(
      "TYPING",
    );
    expect(scrolled).toHaveLength(0);
    expect(document.activeElement?.hasAttribute("data-composer")).toBe(true);
  });
});

describe("W3.2 documents and slides", () => {
  it("?doc= opens the viewer on that document, once", async () => {
    const view = fixtures.reviewInvestorRoom();
    const open = view.documents.find((d) => d.access === "OPEN");
    if (open === undefined) throw new Error("fixture has no open document");
    searchParams = new URLSearchParams({
      tab: "dataroom",
      doc: open.documentId,
    });
    openDocumentAction.mockResolvedValue({
      ok: true,
      value: {
        url: "https://s.example/doc",
        downloadable: false,
        watermark: null,
        downloadUrl: null,
      },
    });
    const room = render(
      <InvestorDataRoom
        companyId={fixtures.REVIEW_COMPANY_ID}
        companyName="Kora Health"
        view={view}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector("iframe")?.getAttribute("src")).toContain(
        "https://s.example/doc",
      ),
    );
    room.rerender(
      <InvestorDataRoom
        companyId={fixtures.REVIEW_COMPANY_ID}
        companyName="Kora Health"
        view={view}
      />,
    );
    expect(openDocumentAction).toHaveBeenCalledTimes(1);
    expect(openDocumentAction).toHaveBeenCalledWith(
      fixtures.REVIEW_COMPANY_ID,
      open.documentId,
    );
  });

  it("?doc= naming a document not open to them opens nothing", async () => {
    const view = fixtures.reviewInvestorRoom();
    const closed = view.documents.find((d) => d.access !== "OPEN");
    searchParams = new URLSearchParams({
      doc: closed?.documentId ?? DOC,
    });
    render(
      <InvestorDataRoom
        companyId={fixtures.REVIEW_COMPANY_ID}
        companyName="Kora Health"
        view={view}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(openDocumentAction).not.toHaveBeenCalled();
  });

  it("?slide= is a slide number, bounded by the deck", () => {
    expect(slideParam("4", 12)).toBe(4);
    expect(slideParam("40", 12)).toBe(12);
    expect(slideParam("0", 12)).toBeNull();
    expect(slideParam("2.5", 12)).toBeNull();
    expect(slideParam("abc", null)).toBeNull();
    expect(slideParam(null, 12)).toBeNull();
    expect(slideParam("3", null)).toBe(3);
  });
});

describe("W3.4 Back after Q's move", () => {
  afterEach(() => {
    registerClientRouter(null);
    resetAppRoutes();
    resetUiActController();
  });

  it("marks Q's entry, arrives with focus, and Back returns to the page before", async () => {
    resetUiActController();
    noteRoute("/home");
    window.history.pushState({ router: "home-tree" }, "", "/home");
    // The client router: a push is a new history entry, then the commit.
    registerClientRouter((path) => {
      window.history.pushState({ router: "tree" }, "", path);
      setTimeout(() => {
        document.body.innerHTML = `<main id="main"><h1>Messages</h1>
          <ol><li data-q-message="${MESSAGE}">hello</li></ol></main>`;
        noteRoute(path);
      }, 20);
    });
    render(<QArrival />);
    const done: string[] = [];
    const stop = onNavigationOutcome((outcome) => done.push(outcome.status));
    const path = `/relationships/company/${COMPANY}/messages?message=${MESSAGE}`;
    await requestNavigation({ path }).settled;
    stop();
    expect(done).toEqual(["DONE"]);
    await waitFor(() =>
      expect(
        document.querySelector(`[data-q-message]`)?.hasAttribute(ARRIVAL_MARK),
      ).toBe(true),
    );
    expect(document.activeElement?.tagName).toBe("H1");
    // The router's own state is kept; Q's mark is added.
    expect(window.history.state).toMatchObject({ router: "tree" });
    expect(qMoveOrigin()?.from).toMatch(/\/home$/u);
    const back = new Promise((resolve) =>
      window.addEventListener("popstate", resolve, { once: true }),
    );
    window.history.back();
    await back;
    expect(window.location.pathname).toBe("/home");
    // The person's own entry carries no Q mark.
    expect(qMoveOrigin()).toBeNull();
  });

  it("markQMove keeps whatever state the entry had", () => {
    window.history.replaceState({ __NA: true, tree: [1] }, "", "/capital");
    markQMove("/home");
    expect(window.history.state).toMatchObject({ __NA: true, tree: [1] });
    expect(qMoveOrigin()?.from).toBe("/home");
  });
});
