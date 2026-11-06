import type { BoardItem } from "@capital-q/contracts";

/** Fictional ids for the deep-links harness and its browser spec. */
export const HARNESS_ITEM = "00000000-0000-4000-8000-0000000b0a2d";
export const HARNESS_MESSAGE = "00000000-0000-4000-8000-00000000a5e5";

const AT = "2026-11-01T09:00:00.000Z";

/** Enough of a board that the item asked for is below the fold. */
export function harnessBoard(): BoardItem[] {
  return Array.from({ length: 24 }, (_, index) => ({
    id:
      index === 21
        ? HARNESS_ITEM
        : `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    kind: "TASK" as const,
    refId: null,
    title:
      index === 21
        ? "Send Tamarind Pay the cap table"
        : `Task ${String(index + 1)}`,
    notes: null,
    status: "TODO" as const,
    position: String(index + 1),
    dueOn: null,
    workJobId: null,
    createdBy: "PERSON" as const,
    revision: 1,
    createdAt: AT,
    updatedAt: AT,
  }));
}

/** A long thread; the one asked for is far up. */
export function harnessThread(): { id: string; text: string; mine: boolean }[] {
  return Array.from({ length: 60 }, (_, index) => ({
    id:
      index === 8
        ? HARNESS_MESSAGE
        : `00000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
    text:
      index === 8
        ? "We can do $2M at the current terms if the data room is complete."
        : `Message ${String(index + 1)}`,
    mine: index % 2 === 0,
  }));
}
