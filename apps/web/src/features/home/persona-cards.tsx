"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@capital-q/ui/button";

/**
 * Which side of the table you are on (QX-001 §12).
 *
 * Two roles, because Capital Q has two. Founder and Investor are the
 * canonical identities the rest of the product already turns on; nothing
 * here invents a third, and choosing one starts the same setup the plain
 * links used to.
 *
 * It is a radio group rather than two links dressed as cards. A person
 * arrows between the options, the selected one is announced as selected,
 * and Enter continues — which a pair of divs with click handlers cannot
 * do. Selection and navigation are separate on purpose: reading both
 * options before committing is the entire point of showing them together.
 */

const PERSONAS = [
  {
    id: "founder",
    lede: "I'm raising capital",
    role: "Founder",
    description:
      "Share what you already have. Q assesses readiness, fills the gaps with you and prepares you for the right investors.",
    href: "/onboarding/founder",
  },
  {
    id: "investor",
    lede: "I deploy capital",
    role: "Investor",
    description:
      "Describe your mandate. Q builds a relevant, explainable view of opportunities and keeps it current.",
    href: "/onboarding/investor",
  },
] as const;

type PersonaId = (typeof PERSONAS)[number]["id"];

export function PersonaCards() {
  const router = useRouter();
  const [selected, setSelected] = useState<PersonaId>("founder");
  const [going, setGoing] = useState(false);
  const refs = useRef<Partial<Record<PersonaId, HTMLButtonElement | null>>>({});

  const chosen = PERSONAS.find((persona) => persona.id === selected);

  const go = () => {
    if (chosen === undefined) return;
    setGoing(true);
    router.push(chosen.href);
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
    <div className="flex flex-col gap-4">
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
              onClick={() => setSelected(persona.id)}
              onDoubleClick={go}
              data-persona={persona.id}
              className={[
                "flex flex-col gap-2 rounded-lg border p-5 text-left transition-colors duration-(--cq-motion-fast)",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
                isSelected
                  ? "border-(--cq-border-strong) bg-(--cq-surface-raised)"
                  : "border-(--cq-border-subtle) bg-(--cq-surface) hover:border-(--cq-border)",
              ].join(" ")}
            >
              <span className="cq-body font-medium text-(--cq-text-primary)">
                {persona.lede}
              </span>
              {/* The role name in words as well as by which card is
                  outlined: selection is never carried by colour alone. */}
              <span className="cq-label text-(--cq-text-tertiary)">
                {persona.role}
                {isSelected ? " · selected" : ""}
              </span>
              <span className="cq-body-sm text-(--cq-text-secondary)">
                {persona.description}
              </span>
            </button>
          );
        })}
      </div>
      <div>
        <Button onClick={go} disabled={going}>
          {chosen === undefined
            ? "Continue"
            : `Continue as ${chosen.role.toLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}
