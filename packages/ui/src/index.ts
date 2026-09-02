/**
 * @capital-q/ui
 *
 * Owns: the `--cq-*` semantic tokens (tokens/tokens.css, exported as
 * `@capital-q/ui/styles.css`), accessible Capital Q-owned primitives on Base
 * UI, styled components, Q patterns, the curated icon set and motion rules
 * (doc 18; doc 23, 84; ERA-030).
 *
 * Does not own: authentication, Q orchestration, domain logic, database
 * access, authorization or eventing. Browser-safe by construction: nothing in
 * this package may import server infrastructure, and lint enforces it.
 *
 * Application code imports through subpaths -- `@capital-q/ui/button`,
 * `@capital-q/ui/sheet`, `@capital-q/ui/q-composer` -- so the underlying
 * headless primitive stays replaceable.
 */

export * from "./tokens/index.js";
export { cx } from "./primitives/class-names.js";
export * from "./components/button.js";
export * from "./components/link.js";
export * from "./components/input.js";
export * from "./components/chip.js";
export * from "./components/badge.js";
export * from "./components/avatar.js";
export * from "./components/states.js";
export * from "./components/tooltip.js";
export * from "./components/menu.js";
export * from "./components/popover.js";
export * from "./components/sheet.js";
export * from "./components/dialog.js";
export * from "./patterns/q-mark.js";
export * from "./patterns/q-state.js";
export * from "./patterns/context-indicator.js";
export * from "./patterns/priority-list.js";
export * from "./patterns/q-composer.js";

export const PACKAGE_NAME = "@capital-q/ui" as const;
