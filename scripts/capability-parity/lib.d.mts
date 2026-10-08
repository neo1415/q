// Types for lib.mjs (the parity test imports it).

export type CollectedControl = {
  readonly id: string;
  readonly kind: string;
  readonly sources: readonly string[];
};

export function controlPrefixes(root: string): Record<string, string>;
export function collectControls(root: string): CollectedControl[];
export function pageRoutes(
  root: string,
): { readonly route: string; readonly file: string }[];
export function kindActs(root: string): Record<string, string[]>;
export function renderCatalog(controls: readonly CollectedControl[]): string;
export function renderMatrix(input: {
  readonly controls: readonly CollectedControl[];
  readonly pages: readonly { readonly route: string; readonly file: string }[];
  readonly actions: readonly {
    readonly name: string;
    readonly classification: string;
    readonly capability: string | null;
    readonly route: string | null;
    readonly does: string;
  }[];
  readonly acts: Readonly<Record<string, readonly string[]>>;
}): string;

export function byCodePoint(a: string, b: string): number;
export const REPO_ROOT: string;
export function generatedFiles(
  root: string,
  actions: readonly unknown[],
  qCapabilityId: (action: never) => string | null,
): Promise<{
  readonly controls: CollectedControl[];
  readonly catalog: { readonly file: string; readonly text: string };
  readonly matrix: { readonly file: string; readonly text: string };
}>;
