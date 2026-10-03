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

In light mode, `apps/web/app/globals.css` sets:

- `--cq-warning: oklch(0.53 0.12 70)`: 4.77:1 or more on the canvas,
  `--cq-surface-subtle` and `--cq-warning-soft`.
- `--cq-positive: oklch(0.5 0.13 151)`: 4.95:1 or more on the same
  backgrounds, including `--cq-positive-soft`.

The override is a plain `:root` rule after the package import. The
package's dark rules (`:root:not([data-theme="light"])` and
`:root[data-theme="dark"]`) are more specific, so dark mode is unchanged.
Hue and chroma stay within the existing families. Status is still never
carried by colour alone; the words stay.

## Consequences

- Status text in these colours is legible on every light surface the app
  uses.
- `packages/ui/src/tokens/tokens.css` keeps its old light values. If the
  package becomes the single source again, move these values there and
  delete the override.
