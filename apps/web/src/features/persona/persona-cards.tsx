"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";

import { Check, ICON_SIZE } from "@capital-q/ui/icons";

/**
 * Which side of the table you are on (QX-001 §12; QX-002 §A5).
 *
 * Two roles, because Capital Q has two. Founder and Investor are the
 * canonical identities the rest of the product already turns on; nothing
 * here invents a third, and choosing one starts the same setup the plain
 * links used to.
 *
 * A click chooses. That sounds obvious and the first version got it
 * wrong: selecting and continuing were separate steps, so clicking a
 * large, obviously-clickable card only marked it "selected" and left
 * people waiting for something to happen. Reading both options before
 * committing is what having them side by side already achieves; it does
 * not need a second button to enforce it.
 *
 * Keyboard keeps the radio-group behaviour, because there it is the
 * behaviour people expect: arrows move between the options without
 * choosing, and Enter or Space on the focused card goes. There is no
 * separate "Continue as …" button (founder live 2026-10-05: "why is there
 * an extra button?"): the card is the button. That is why
 * these are buttons in a radiogroup rather than two links — a link would
 * navigate on arrow-focus and a div would do neither.
 *
 * One component, used on Home and at first run, so the question Q asks
 * aloud and the cards on screen can never drift into two different
 * vocabularies for the same choice.
 */

export const PERSONAS = [
  {
    id: "founder",
    lede: "Raising capital",
    role: "Founder",
    description: "Prepare, improve and raise.",
    href: "/onboarding/founder",
  },
  {
    id: "investor",
    lede: "Investing",
    role: "Investor",
    description: "Discover, evaluate and manage inbound.",
    href: "/onboarding/investor",
  },
] as const;

export type PersonaId = (typeof PERSONAS)[number]["id"];

export function PersonaCards({
  autoFocus = false,
  onChoose,
}: {
  /** First run puts the choice in front of the person; Home does not. */
  readonly autoFocus?: boolean | undefined;
  /**
   * Told which role was chosen, before the navigation. First run uses it
   * to stop Q talking; nothing here decides identity — the onboarding
   * path the person lands on does, under their own authority.
   */
  readonly onChoose?: ((persona: PersonaId) => void) | undefined;
} = {}) {
  const router = useRouter();
  const [selected, setSelected] = useState<PersonaId>("founder");
  const [going, setGoing] = useState(false);
  const refs = useRef<Partial<Record<PersonaId, HTMLButtonElement | null>>>({});

  const go = (id: PersonaId) => {
    const persona = PERSONAS.find((candidate) => candidate.id === id);
    if (persona === undefined || going) return;
    setGoing(true);
    onChoose?.(persona.id);
    router.push(persona.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Arrow keys move within the group, as a radio group does. Home and
    // End go to the ends, because somebody using a keyboard expects them.
    const order = PERSONAS.map((persona) => persona.id);
    const index = order.indexOf(selected);
    let next: PersonaId | undefined;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = order[(index + 1) % order.length];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = order[(index - 1 + order.length) % order.length];
        break;
      case "Home":
        next = order[0];
        break;
      case "End":
        next = order[order.length - 1];
        break;
      default:
        return;
    }
    if (next === undefined) return;
    event.preventDefault();
    setSelected(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="flex max-w-(--cq-layout-narrow) flex-col gap-4">
      {/*
        Two compact options, not two wide cards (design/visual-debt.md,
        Home persona choice). Selection reads three ways: the strong
        border and accent-soft ground, the check, and the word.
      */}
      <div
        role="radiogroup"
        aria-label="What are you here to do?"
        onKeyDown={onKeyDown}
        className="grid gap-3 sm:grid-cols-2"
        data-persona-cards
      >
        {PERSONAS.map((persona) => {
          const isSelected = persona.id === selected;
          return (
            <button
              key={persona.id}
              ref={(element) => {
                refs.current[persona.id] = element;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              // One stop in the tab order for the whole group, then arrows
              // inside it.
              tabIndex={isSelected ? 0 : -1}
              autoFocus={autoFocus && isSelected}
              // Choose and go. Arrow keys still move without choosing,
              // so nothing is committed by simply looking.
              onClick={() => {
                setSelected(persona.id);
                go(persona.id);
              }}
              data-persona={persona.id}
              className={[
                "flex min-h-11 items-start gap-3 rounded-md border px-4 py-3 text-left transition-colors duration-(--cq-motion-fast)",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
                isSelected
                  ? "border-(--cq-border-strong) bg-(--cq-accent-soft)"
                  : "border-(--cq-border) bg-(--cq-surface) hover:border-(--cq-border-strong)",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-(--cq-motion-fast)",
                  isSelected
                    ? "border-(--cq-accent) bg-(--cq-accent) text-(--cq-text-inverse)"
                    : "border-(--cq-border-strong) bg-(--cq-surface-raised)",
                ].join(" ")}
              >
                {isSelected ? (
                  <Check size={ICON_SIZE.compact - 2} strokeWidth={3} />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="cq-body font-medium text-(--cq-text-primary)">
                  {persona.lede}
                </span>
                {/* The role name in words as well as by which option is
                    marked: selection is never carried by colour alone. */}
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {persona.role} · {persona.description}
                  {isSelected ? (
                    <span className="sr-only"> · selected</span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
