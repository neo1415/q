"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cx } from "@capital-q/ui";
import {
  CircleHelp,
  Download,
  Link as LinkIcon,
  MapPin,
  Search,
  ShieldCheck,
  UserRound,
} from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import { LogoTile } from "@/features/investors/match-marks";
import { crmButton } from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import {
  OPEN_SEARCH,
  readRecent,
  rememberOpened,
  type RecentItem,
  type RecentPerson,
} from "./recent-opened";
import {
  searchPaletteAction,
  type PaletteCard,
  type PaletteResult,
  type PaletteVideo,
} from "./search-actions";
import type { NameMatch } from "./name-matches";

/**
 * Search as a palette (app prototype "search", option 2, warm charcoal):
 * it opens over whatever the person is doing, from the Search page or by
 * pressing / anywhere, so they never lose their place. People and videos
 * come grouped, each saying where the person knows them from; a whole
 * @handle opens that person's Q Card exactly as they publish it; no match
 * says what to do instead. Every result is the server's (search-actions).
 */

export type SearchPaletteProps = {
  /** The signed-in account, so "recently opened" is theirs alone. */
  readonly viewer: string;
  readonly search?: ((query: string) => Promise<PaletteResult>) | undefined;
};

const WHERE: Readonly<Record<string, string>> = {
  "Your relationship": "In your CRM",
  "In your Discover": "In Discover",
};

/** "0:58" for a pitch's length; null when it is not known. */
export function durationWords(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A query worth asking: two characters, or any @handle. */
function isAskable(query: string): boolean {
  const text = query.trim();
  return text.length >= 2 || (text.startsWith("@") && text.length > 1);
}

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function SearchPalette({
  viewer,
  search = searchPaletteAction,
}: SearchPaletteProps) {
  const t = useT();
  const router = useRouter();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<PaletteResult>({ kind: "EMPTY" });
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<readonly RecentItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const asked = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);

  const show = useCallback(
    (initial: string) => {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setRecent(readRecent(viewer));
      setQuery(initial);
      setBusy(isAskable(initial));
      setCursor(0);
      setOpen(true);
      requestAnimationFrame(() => {
        setShown(true);
        input.current?.focus();
      });
    },
    [viewer],
  );

  const close = useCallback(() => {
    setShown(false);
    setTimeout(() => {
      setOpen(false);
      returnFocus.current?.focus();
    }, 180);
  }, []);

  // "/" from anywhere, and the Search page's own bar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        editable(event.target)
      ) {
        return;
      }
      event.preventDefault();
      show("");
    };
    const onOpen = (event: Event) => {
      const detail: unknown =
        event instanceof CustomEvent ? (event.detail as unknown) : null;
      show(
        typeof detail === "object" &&
          detail !== null &&
          "query" in detail &&
          typeof detail.query === "string"
          ? detail.query
          : "",
      );
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH, onOpen);
    };
  }, [show]);

  // Ask the server as they type: short pause, newest answer wins. Too
  // short a query is not asked at all; the palette shows the empty state.
  const askable = isAskable(query);
  useEffect(() => {
    if (!open || !isAskable(query)) return;
    const text = query.trim();
    const ask = ++asked.current;
    const timer = setTimeout(() => {
      void search(text)
        .catch((): PaletteResult => ({ kind: "ERROR" }))
        .then((answer) => {
          if (ask !== asked.current) return;
          setResult(answer);
          setCursor(0);
          setBusy(false);
        });
    }, 160);
    return () => clearTimeout(timer);
  }, [open, query, search]);

  const remember = (item: RecentItem) => rememberOpened(viewer, item);

  if (!open) return null;

  const view: PaletteResult = askable ? result : { kind: "EMPTY" };
  const people: readonly (NameMatch | RecentPerson)[] =
    view.kind === "NAMES"
      ? view.people
      : view.kind === "EMPTY"
        ? recent.filter((item): item is RecentPerson => item.kind === "person")
        : [];
  const videos: readonly PaletteVideo[] =
    view.kind === "NAMES"
      ? view.videos
      : view.kind === "EMPTY"
        ? recent.flatMap((item) => (item.kind === "video" ? [item] : []))
        : [];
  const hrefs = [
    ...people.map((p) => p.href),
    ...videos.map((v) => `/company/${encodeURIComponent(v.companyId)}`),
  ];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" && hrefs.length > 0) {
      event.preventDefault();
      setCursor((at) => (at + 1) % hrefs.length);
    } else if (event.key === "ArrowUp" && hrefs.length > 0) {
      event.preventDefault();
      setCursor((at) => (at - 1 + hrefs.length) % hrefs.length);
    } else if (event.key === "Enter" && hrefs[cursor] !== undefined) {
      event.preventDefault();
      const at = cursor;
      const person = people[at];
      if (person !== undefined) remember(personOf(person));
      else {
        const video = videos[at - people.length];
        if (video !== undefined) remember({ kind: "video", ...video });
      }
      close();
      router.push(hrefs[at] ?? "/search");
    }
  };

  return createPortal(
    <div
      className="cq-charcoal fixed inset-0 z-(--cq-z-modal)"
      data-search-palette
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label={t("Close search")}
        tabIndex={-1}
        className={cx(
          "absolute inset-0 bg-(--cq-overlay) transition-opacity duration-[180ms] ease-(--cq-ease)",
          shown ? "opacity-100" : "opacity-0",
        )}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={inputId}
        className={cx(
          "absolute inset-0 flex flex-col overflow-hidden bg-(--cq-surface-raised) shadow-(--cq-shadow-overlay) transition-[opacity,transform] duration-[180ms] ease-(--cq-ease) motion-reduce:transition-none lg:inset-auto lg:start-1/2 lg:top-[90px] lg:w-[640px] lg:-translate-x-1/2 lg:rounded-2xl lg:border lg:border-(--cq-border) rtl:lg:translate-x-1/2",
          shown
            ? "translate-y-0 opacity-100 lg:scale-100"
            : "translate-y-3 opacity-0 lg:-translate-y-2 lg:scale-[0.98]",
        )}
      >
        <div className="flex min-h-[60px] items-center gap-2.5 border-b border-(--cq-border-subtle) px-4">
          <Search
            size={20}
            aria-hidden="true"
            className="flex-none text-(--cq-text-tertiary)"
          />
          <label htmlFor={`${inputId}-input`} id={inputId} className="sr-only">
            {t("Search people and videos")}
          </label>
          <input
            ref={input}
            id={`${inputId}-input`}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setBusy(isAskable(event.target.value));
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t("A name, or an @handle")}
            className="min-w-0 flex-1 bg-transparent text-[17px] text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary)"
            aria-busy={busy}
            data-search-input
          />
          <button type="button" onClick={close} className={crmButton("quiet")}>
            {t("Esc")}
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto px-2.5 pt-2 pb-3.5 lg:max-h-[520px]"
          aria-live="polite"
        >
          <Body
            result={view}
            busy={busy}
            people={people}
            videos={videos}
            cursor={cursor}
            onPick={(item) => {
              remember(item);
              close();
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function personOf(person: NameMatch | RecentPerson): RecentPerson {
  if (person.kind === "person") return person;
  const match = person;
  return {
    kind: "person",
    name: match.name,
    href: match.href,
    entity: match.kind,
    companyId: match.companyId,
    where: WHERE[match.detail] ?? match.detail,
    line: match.kind === "company" ? "Company" : "Investor",
  };
}

function Group({ children }: { readonly children: ReactNode }) {
  return (
    <div className="px-2 pt-2.5 pb-1 text-xs text-(--cq-text-tertiary)">
      {children}
    </div>
  );
}

function Body({
  result,
  busy,
  people,
  videos,
  cursor,
  onPick,
}: {
  readonly result: PaletteResult;
  readonly busy: boolean;
  readonly people: readonly (NameMatch | RecentPerson)[];
  readonly videos: readonly PaletteVideo[];
  readonly cursor: number;
  readonly onPick: (item: RecentItem) => void;
}) {
  const t = useT();
  if (result.kind === "CARD") {
    return (
      <div className="cq-crm-swap">
        <Group>
          {t("Q Card for")} @{result.card.handle}
        </Group>
        <div className="px-2 py-1.5">
          <PaletteQCard
            card={result.card}
            onOpen={() =>
              onPick({
                kind: "person",
                name: result.card.name,
                href: `/@${result.card.handle}`,
                entity:
                  result.card.subjectType === "COMPANY"
                    ? "company"
                    : "investor",
                where: "Found by handle",
                line: result.card.descriptor,
              })
            }
          />
        </div>
      </div>
    );
  }
  if (result.kind === "NO_CARD") {
    return (
      <Nobody
        title={`${t("No Q Card at")} @${result.handle}`}
        body={t("Check the spelling with them. A handle is their whole @name.")}
      />
    );
  }
  if (result.kind === "ERROR") {
    return (
      <Nobody
        title={t("Search couldn't answer just now")}
        body={t("Nothing is wrong on your side. Try again in a moment.")}
      />
    );
  }
  if (result.kind === "NAMES" && people.length === 0 && videos.length === 0) {
    return busy ? null : (
      <Nobody
        title={`${t("No one called")} “${result.query}” ${t("you can see")}`}
        body={t(
          "No one by that name among your relationships or Discover. Anyone else is found by their @handle.",
        )}
      />
    );
  }
  if (result.kind === "EMPTY" && people.length === 0 && videos.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-(--cq-text-secondary)">
        {t(
          "A name searches your relationships and Discover. Anyone else is found by their whole @handle.",
        )}
      </p>
    );
  }
  return (
    <div className="cq-crm-swap">
      {people.length === 0 ? null : (
        <>
          <Group>
            {result.kind === "EMPTY"
              ? t("Recently opened")
              : t("People you can see")}
          </Group>
          {people.map((person, at) => {
            const row = personOf(person);
            return (
              <NameRow
                key={row.href}
                person={row}
                active={cursor === at}
                onOpen={() => onPick(row)}
              />
            );
          })}
        </>
      )}
      {videos.length === 0 ? null : (
        <>
          <Group>{t("Videos")}</Group>
          {videos.map((video, at) => (
            <VideoRow
              key={video.mediaAssetId}
              video={video}
              active={cursor === people.length + at}
              onOpen={() => onPick({ kind: "video", ...video })}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function NameRow({
  person,
  active = false,
  onOpen,
}: {
  readonly person: RecentPerson;
  readonly active?: boolean | undefined;
  readonly onOpen?: (() => void) | undefined;
}) {
  const t = useT();
  return (
    <Link
      href={person.href}
      {...(onOpen === undefined ? {} : { onClick: onOpen })}
      className={cx(
        "grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2 py-2.5 text-start transition-colors duration-(--cq-motion-fast) [&+&]:border-t [&+&]:border-(--cq-border-subtle) [@media(hover:hover)_and_(pointer:fine)]:hover:bg-(--cq-surface-subtle)",
        active && "bg-(--cq-accent-soft)",
      )}
      data-search-person={person.href}
    >
      <EntityAvatar
        kind={person.entity}
        name={person.name}
        companyId={person.companyId}
        decorative
      />
      <span className="min-w-0">
        <b className="block truncate text-[15px] font-semibold text-(--cq-text-primary)">
          {person.name}
        </b>
        {person.line === null ? null : (
          <span className="block truncate text-[13px] text-(--cq-text-secondary)">
            {t(person.line)}
          </span>
        )}
      </span>
      <span className="inline-flex items-center rounded-full bg-(--cq-surface-strong) px-2 py-0.5 text-xs font-medium whitespace-nowrap text-(--cq-text-secondary)">
        {t(person.where)}
      </span>
    </Link>
  );
}

function VideoRow({
  video,
  active,
  onOpen,
}: {
  readonly video: PaletteVideo;
  readonly active: boolean;
  readonly onOpen: () => void;
}) {
  const t = useT();
  const length = durationWords(video.durationSeconds);
  return (
    <Link
      href={`/company/${encodeURIComponent(video.companyId)}`}
      onClick={onOpen}
      className={cx(
        "grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2 py-2.5 text-start transition-colors duration-(--cq-motion-fast) [@media(hover:hover)_and_(pointer:fine)]:hover:bg-(--cq-surface-subtle)",
        active && "bg-(--cq-accent-soft)",
      )}
      data-search-video={video.mediaAssetId}
    >
      <LogoTile
        kind="company"
        name={video.company}
        companyId={video.companyId}
        size={32}
      />
      <span className="min-w-0">
        <b className="block truncate text-[15px] font-semibold text-(--cq-text-primary)">
          {video.title ?? t("Pitch")}
        </b>
        <span className="block truncate text-[13px] text-(--cq-text-secondary)">
          {length === null ? video.company : `${video.company}, ${length}`}
        </span>
      </span>
      <span className="inline-flex items-center rounded-full bg-(--cq-surface-strong) px-2 py-0.5 text-xs font-medium text-(--cq-text-secondary)">
        {t("Video")}
      </span>
    </Link>
  );
}

function Nobody({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div
      className="cq-crm-swap m-2 flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-6 py-10 text-center"
      data-state="none"
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full bg-(--cq-surface-strong) text-(--cq-text-secondary)"
      >
        <UserRound size={22} />
      </span>
      <b className="text-base text-(--cq-text-primary)">{title}</b>
      <p className="max-w-[44ch] text-sm text-(--cq-text-secondary)">{body}</p>
    </div>
  );
}

/** A Q Card as its owner publishes it, in the palette. */
export function PaletteQCard({
  card,
  onOpen,
}: {
  readonly card: PaletteCard;
  readonly onOpen?: (() => void) | undefined;
}) {
  const t = useT();
  return (
    <div
      className="flex max-w-[460px] flex-col gap-3.5 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 shadow-[0_1px_0_var(--cq-border-subtle)]"
      data-palette-card={card.handle}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-(--cq-text-primary)">
          Capital Q
        </span>
        <span className="text-[13px] text-(--cq-text-secondary)">
          @{card.handle}
        </span>
      </div>
      <div className="flex items-center gap-3.5">
        <LogoTile
          kind={card.subjectType === "COMPANY" ? "company" : "investor"}
          name={card.name}
        />
        <div className="min-w-0">
          <b className="block text-xl font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
            {card.name}
          </b>
          {card.descriptor === null && card.tagline === null ? null : (
            <span className="text-sm text-(--cq-text-secondary)">
              {card.tagline ?? card.descriptor}
            </span>
          )}
        </div>
      </div>
      {card.place === null && card.website === null ? null : (
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-(--cq-text-secondary)">
          {card.place === null ? null : (
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} aria-hidden="true" />
              {card.place}
            </span>
          )}
          {card.website === null ? null : (
            <a
              href={card.website.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
            >
              <LinkIcon size={14} aria-hidden="true" />
              {card.website.label}
            </a>
          )}
        </div>
      )}
      {card.verified.length === 0 ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-(--cq-text-tertiary)">
          <CircleHelp size={14} aria-hidden="true" />
          {t("Identity not verified by Capital Q")}
        </span>
      ) : (
        card.verified.map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 text-xs text-(--cq-positive)"
          >
            <ShieldCheck size={14} aria-hidden="true" />
            {t(label)}
          </span>
        ))
      )}
      <div className="flex flex-wrap gap-2">
        <Link
          href={card.connectHref ?? `/@${card.handle}`}
          {...(onOpen === undefined ? {} : { onClick: onOpen })}
          className={crmButton("primary", "max-sm:flex-1")}
          data-palette-connect
        >
          {card.connectHref === null
            ? t("Open their Q Card")
            : t("Connect on Capital Q")}
        </Link>
        <a
          href={`/@${card.handle}.vcf`}
          download={`${card.handle}.vcf`}
          className={crmButton("secondary", "max-sm:flex-1")}
        >
          <Download size={14} aria-hidden="true" />
          {t("Save contact")}
        </a>
      </div>
    </div>
  );
}
