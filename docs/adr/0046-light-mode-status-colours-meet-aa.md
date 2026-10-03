# ADR 0046 — Light-mode status colours meet AA

## Status

Accepted — 2026-10-03. Lead decision on the design-48 redesign.

## Context

Measured on the light canvas (`--cq-canvas`), `--cq-warning`
(`oklch(0.67 0.14 78)`) reached 2.93:1 and `--cq-positive`
(`oklch(0.55 0.13 151)`) 4.39:1. Both are used for status words such as
"Needs a new answer" and "Answered", which WCAG 1.4.3 requires at 4.5:1.
Dark-mode values already pass (9.97:1 and 8.23:1).

## Decision

In light mode, `packages/ui/src/tokens/tokens.css` sets:

- `--cq-warning: oklch(0.53 0.12 70)`: 4.77:1 or more on the canvas,
  `--cq-surface-subtle` and `--cq-warning-soft`.
- `--cq-positive: oklch(0.5 0.13 151)`: 4.95:1 or more on the same
  backgrounds, including `--cq-positive-soft`.

The values live in the package's light `:root` block, the one source of
truth; `globals.css` does not redefine them (a test enforces both the
contrast and the absence of an override). Dark values are unchanged.
Hue and chroma stay within the existing families. Status is still never
carried by colour alone; the words stay.

This amends doc 18's light token table for these two values.

## Consequences

- Status text in these colours is legible on every light surface the app
  uses.
