# ADR 0025: A deck's look may carry what the person asked for

Status: Accepted (2026-09-29)
Amends: QX-004 §3.3 (three named visual directions; no model-chosen colours)

## Context

A founder asked Q, repeatedly, to make their deck's first page a green-and-white
gradient with the company name in black. Q filed versions 2 to 5, all identical
to version 1. A revision could change section prose and nothing else, and a deck
is drawn from its slides and its visual direction. The prompt also told the model
it "cannot change the document", so it said so, and then Capital Q reported a
new version anyway.

QX-004 kept colours out of a model's hands so decks would not come out as generic
AI slides. That rule is about Q choosing a look. It was never meant to stop a
person choosing their own.

## Decision

- `QDeck` gains an optional `cover`: one or two `#rrggbb` stops (a fill, or a
  gradient from the first to the second) and an optional title ink. It is content,
  like the existing `accent`: it describes the person's deck and never touches the
  `--cq-*` product tokens.
- ARTIFACT_REVISION v2 may set `cover` and `accent` only when the instruction names
  colours; otherwise `style` is null. It may also rewrite slide text, under the
  same no-new-figures check as prose.
- Every renderer draws the cover: SVG as a real gradient, PDF and PPTX as fine
  bands, since neither has a gradient primitive we rely on. Without a chosen ink,
  the title takes whichever of black or white reads on every stop. The inspector
  checks contrast against every stop.
- The answer prompt says Capital Q makes and revises decks and PDFs, and never
  that it cannot.

## Consequences

The three named directions stay the default and the only look Q picks on its own.
A person's colour choice is applied as given, including one that reads poorly; the
inspector reports it rather than overriding them.
