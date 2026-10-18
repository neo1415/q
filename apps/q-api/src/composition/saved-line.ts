/**
 * What Q says once an approved profile change is saved: the lines of the
 * change's own preview, joined into one sentence. Each line is someone's
 * text and may already end in a full stop; the sentence ends in exactly one
 * (R30 #26: "...Lagos market traders..").
 */
export function savedReadsLine(what: string, preview: string): string {
  const parts = preview
    .split("\n")
    .map((line) => line.trim().replace(/[.;\s]+$/u, ""))
    .filter((line) => line.length > 0);
  return `Saved. ${what} now reads: ${parts.join("; ")}.`;
}
