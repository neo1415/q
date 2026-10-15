import type { QManifestRefKind } from "@capital-q/contracts";

/**
 * Lane W: marks one rendered record (a row, a card) so the manifest can
 * tell which of a section's records are visible now. Spread it on the
 * record's element: `<li {...qRef("COMPANY", id)}>`. An id only; the Q API
 * reads it back as the person like every other ref. Usable from server
 * components (no client code).
 */
export function qRef(
  kind: QManifestRefKind,
  id: string,
): { readonly "data-q-ref": string } {
  return { "data-q-ref": `${kind}:${id}` };
}
