"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  ArrowUpRight,
  ChevronLeft,
  ICON_SIZE,
  ICON_STROKE,
  PanelLeft,
  PanelRight,
} from "@capital-q/ui/icons";

import { QAperture } from "@/features/q-aperture";
import { useQSessionOptional } from "@/features/q/q-session";
import { useT } from "@/features/i18n/language";

import {
  Q_PANE_DEFAULT,
  Q_PANE_MAX,
  Q_PANE_MIN,
  Q_PANE_STEP,
} from "./layout-rules";
import {
  getWorkspaceLayout,
  setPane,
  setQWidth,
  useWorkspaceLayout,
} from "./layout-store";
import {
  noteOwnMove,
  notePageMove,
  ownMoveJustNow,
  watchPageActivity,
} from "./workspace-screen";

/** The phone layout (W1.6): Q full screen, the page as a sheet. */
export const PHONE_QUERY = "(max-width: 860px)";

function subscribePhone(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePhoneWorkspace(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

const Q_HOME = "/home";

/** The phone's page sheet is opened from the Q pane by this event. */
const OPEN_SHEET_EVENT = "cq-ws-open-sheet";
function openPageSheet(): void {
  window.dispatchEvent(new Event(OPEN_SHEET_EVENT));
}

/**
 * The Q pane (W1.2–W1.4): the one Q conversation, mounted once in the
 * layout so changing pages never remounts it. Collapsed, it is a thin edge
 * with Q's mark, one tap from open, and Q still knows the page.
 */
export function WorkspaceQPane({ children }: { readonly children: ReactNode }) {
  const t = useT();
  const session = useQSessionOptional();
  // Which of these shows is CSS's call (the `<html>` attributes the boot
  // script sets before paint), so the first frame is already right.
  return (
    <aside className="cq-ws-q" aria-label={t("Q")} data-ws-q>
      <div className="cq-ws-q-body">{children}</div>
      <button
        type="button"
        className="cq-ws-q-edge"
        onClick={() => setPane("qPane", "open")}
        aria-label={t("Show Q")}
        title={t("Show Q")}
        data-ws-q-expand
      >
        <QAperture state={session?.presence.state ?? "IDLE"} size={28} />
      </button>
      {/* Phone only (CSS): open the page sheet, where the menu is. */}
      <button
        type="button"
        className="cq-ws-toggle cq-ws-pages-open"
        onClick={openPageSheet}
        aria-label={t("Open pages")}
        title={t("Open pages")}
        data-ws-pages-open
      >
        <PanelRight
          size={ICON_SIZE.regular}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
        />
      </button>
      <QPaneSeparator />
      <div className="cq-ws-q-foot">
        <button
          type="button"
          className="cq-ws-toggle cq-ws-q-collapse"
          onClick={() => setPane("qPane", "collapsed")}
          aria-label={t("Hide Q")}
          title={t("Hide Q")}
          data-ws-q-collapse
        >
          <PanelLeft
            size={ICON_SIZE.regular}
            strokeWidth={ICON_STROKE}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="cq-ws-toggle cq-ws-page-expand"
          onClick={() => setPane("pagePane", "open")}
          aria-label={t("Show pages")}
          title={t("Show pages")}
          data-ws-page-expand
        >
          <PanelRight
            size={ICON_SIZE.regular}
            strokeWidth={ICON_STROKE}
            aria-hidden="true"
          />
        </button>
      </div>
    </aside>
  );
}

/**
 * The resizable edge between Q and the page (W1.3): drag, ←/→ by 24 px,
 * Home/End for the limits, double-click for the default width.
 */
function QPaneSeparator() {
  const t = useT();
  const layout = useWorkspaceLayout();
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const rtl = () => document.documentElement.dir === "rtl";
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.clientX,
      startWidth: getWorkspaceLayout().qWidth,
    };
    document.documentElement.setAttribute("data-cq-ws-resizing", "");
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start === null) return;
    const delta = event.clientX - start.startX;
    setQWidth(start.startWidth + (rtl() ? -delta : delta));
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.documentElement.removeAttribute("data-cq-ws-resizing");
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const width = getWorkspaceLayout().qWidth;
    const grow = rtl() ? "ArrowLeft" : "ArrowRight";
    const shrink = rtl() ? "ArrowRight" : "ArrowLeft";
    let next: number | null = null;
    if (event.key === grow) next = width + Q_PANE_STEP;
    else if (event.key === shrink) next = width - Q_PANE_STEP;
    else if (event.key === "Home") next = Q_PANE_MIN;
    else if (event.key === "End") next = Q_PANE_MAX;
    if (next === null) return;
    event.preventDefault();
    setQWidth(next);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t("Resize Q")}
      aria-valuemin={Q_PANE_MIN}
      aria-valuemax={Q_PANE_MAX}
      aria-valuenow={layout.qWidth}
      className="cq-ws-separator"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setQWidth(Q_PANE_DEFAULT)}
      onKeyDown={onKeyDown}
      data-ws-separator
    />
  );
}

/** Page titles read "Discover · Capital Q"; the bar names the page only. */
function pageTitle(): string {
  const title = document.title.split(/\s[·|–-]\s/u)[0]?.trim() ?? "";
  return title.length > 0 ? title : "the page";
}

/**
 * The page pane (W1.3/W1.4) and, on a phone, the page sheet (W1.6).
 *
 * On a phone Q stays full screen. When Q moves the page, a slim bar says
 * what it opened; tapping it slides the page up. While the sheet is open
 * it follows Q's moves. The person's own link presses open the sheet.
 */
export function WorkspacePagePane({
  children,
}: {
  readonly children: ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const phone = usePhoneWorkspace();
  // A hard load of a page (not Q's home) opens on that page.
  const [sheetOpen, setSheetOpen] = useState(() => pathname !== Q_HOME);
  // The page Q moved to while the sheet was closed (the peek bar's).
  const [peek, setPeek] = useState<string | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);

  // A press on a link, or Back/Forward, is the person's own move.
  useEffect(() => {
    const mark = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a[href]") !== null) {
        noteOwnMove();
      }
    };
    const back = () => {
      noteOwnMove();
    };
    document.addEventListener("click", mark, true);
    window.addEventListener("popstate", back);
    return () => {
      document.removeEventListener("click", mark, true);
      window.removeEventListener("popstate", back);
    };
  }, []);

  // A page change, decided as it renders (no effect cascade).
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (phone) {
      if (pathname === Q_HOME) {
        setSheetOpen(false);
        setPeek(null);
      } else if (ownMoveJustNow()) {
        setSheetOpen(true);
        setPeek(null);
      } else if (!sheetOpen) {
        // Q's move: an open sheet follows it; a closed one gets the bar.
        setPeek(pathname);
      }
    }
  }

  // Q is told the page before its last move, and when the person is busy
  // in the page pane (screen.workspace; W4's policy reads both).
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    notePageMove(shownPath.current, ownMoveJustNow());
    shownPath.current = pathname;
  }, [pathname]);
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pane = paneRef.current;
    return pane === null ? undefined : watchPageActivity(pane);
  }, []);

  const openSheet = useCallback(() => {
    setPeek(null);
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useEffect(() => {
    window.addEventListener(OPEN_SHEET_EVENT, openSheet);
    return () => window.removeEventListener(OPEN_SHEET_EVENT, openSheet);
  }, [openSheet]);

  useEffect(() => {
    if (!phone || !sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phone, sheetOpen]);

  const hiddenOnPhone = phone && !sheetOpen;
  return (
    <>
      {phone && peek !== null && !sheetOpen ? (
        <PeekBar key={peek} onView={openSheet} />
      ) : null}
      <div
        ref={paneRef}
        className="cq-shell-body cq-ws-page"
        inert={hiddenOnPhone}
        data-ws-page
        // Read by CSS at phone widths only, so it is right before hydration.
        data-ws-sheet={sheetOpen ? "open" : "closed"}
        {...(phone && sheetOpen
          ? { role: "dialog", "aria-modal": false, "aria-label": t("Page") }
          : {})}
      >
        {/* Shown by CSS at phone widths only. */}
        <div className="cq-ws-sheet-bar">
          <button
            type="button"
            className="cq-ws-back-to-q"
            onClick={closeSheet}
            data-ws-back-to-q
          >
            <ChevronLeft
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
              aria-hidden="true"
            />
            {t("Back to Q")}
          </button>
        </div>
        {children}
        <div className="cq-ws-page-foot">
          <button
            type="button"
            className="cq-ws-toggle"
            onClick={() => setPane("pagePane", "collapsed")}
            aria-label={t("Hide pages")}
            title={t("Hide pages")}
            data-ws-page-collapse
          >
            <PanelRight
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * "↗ Opened Messages · View" (W1.6). The page's title is read a moment
 * after the move, once the new page has named itself.
 */
function PeekBar({ onView }: { readonly onView: () => void }) {
  const t = useT();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setTitle(pageTitle()), 120);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="cq-ws-peek" role="status" data-ws-peek>
      <button type="button" className="cq-ws-peek-button" onClick={onView}>
        <ArrowUpRight
          size={ICON_SIZE.regular}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">
          {t("Opened")} {title ?? t("the page")}
        </span>
        <span className="cq-ws-peek-view">{t("View")}</span>
      </button>
    </div>
  );
}
