import type { HubSide } from "@/features/relationships/hub-view";

/**
 * The Work page's tabs (owner-approved 2026-10-18,
 * docs/design/work-one-page-proposal.md): one sidebar entry, "Work", and
 * one strip of tabs in the CRM's style on each of the existing pages.
 * Navigation only: every tab is the page it always was, at its own
 * address, so Q's route table and voice destinations still open each one
 * directly, with no model call.
 */
export type WorkView =
  "tasks" | "board" | "documents" | "pitch" | "rehearsals" | "daily";

export type WorkTab = {
  readonly view: WorkView;
  readonly label: string;
  readonly href: string;
};

/**
 * The tabs a side sees. Pitch is a founder's own (an investor has no pitch
 * to make; the page refuses anyone else whatever the strip shows), and its
 * data room is reached from there. Rehearsals are for founders and
 * investors, as the sidebar entry was.
 */
export function workTabs(side: HubSide = "NONE"): readonly WorkTab[] {
  return [
    { view: "tasks", label: "Tasks", href: "/work" },
    // The work board (owner 2026-10-23): their own items, Q's too.
    { view: "board", label: "Board", href: "/board" },
    { view: "documents", label: "Documents", href: "/documents" },
    ...(side === "COMPANY"
      ? [{ view: "pitch" as const, label: "Pitch", href: "/pitch" }]
      : []),
    ...(side === "NONE"
      ? []
      : [
          {
            view: "rehearsals" as const,
            label: "Rehearsals",
            href: "/rehearsals",
          },
        ]),
    { view: "daily", label: "The Q Daily", href: "/daily" },
  ];
}

/** The founder's own data room and deck, reached from the Pitch tab. */
export const WORK_DATA_ROOM_HREF = "/company/data-room";
