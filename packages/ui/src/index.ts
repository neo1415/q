/**
 * @capital-q/ui
 *
 * Owns: generic, reusable Capital Q visual primitives built on the design-system
 * tokens — the components that are not specific to any one product surface
 * (doc 23, 84; ERA-030).
 * Does not own: feature UI, and never database or domain-service imports.
 *
 * No component library exists yet. The visual system is defined by
 * docs/architecture/17 and 18 and is implemented by the Web track, so this
 * package deliberately carries no React dependency at bootstrap.
 */

export const PACKAGE_NAME = "@capital-q/ui" as const;
