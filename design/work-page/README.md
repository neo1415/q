# Work page: design prototype (PROPOSED, for owner approval)

A static prototype of `docs/design/work-one-page-proposal.md`. It is not product code: nothing in `apps/` or `packages/` changed. Colours, type, motion and layout values are copied from `packages/ui/src/tokens/tokens.css` and the live "Black and gold" preset (`apps/web/src/features/brand-theme/brand-presets.ts`). All names are fictional.

- **Watch:** `deliverables/work-page-walkthrough.mp4` (63 s, 1280×800, captions name each state).
- **Look:** `deliverables/screens/*.png`.
- **Open:** `index.html` in a browser. `?tab=`, `role=founder`, `theme=dark`, `state=empty|loading|error`, `nav=a|b`, `sheet=more`, `reader=1`, `motion=reduced` and `view=compare` select each state; `phones.html` shows the three phones.

## What each screen shows

| Screen | Shows |
| --- | --- |
| 01 / 02b | Desktop light, investor and founder. Sidebar reads **Discover · Explore · Q · CRM · Work**, with Profile and Settings in the footer. Work › Tasks covers: the "Give Q a task…" input; **Needs you**, an approval with the exact message, *On its own* / *Asks first*, and Approve, Review, Not now; a contradiction kept for review; **In progress**, a running job with its step, spend and Stop, plus a standing instruction; **Done this week**; and the Q suggests rail. |
| 02 | The same in dark: the sidebar turns black and the accent turns gold. |
| 03a / 03b | Work › Documents: search, sort, grid/list, Upload, and the All / Uploaded / Made by Q filter. One document Q is still writing. A Q brief open in the in-app reader sheet. |
| 04 / 04b | Work › Pitch (founder only): pitch video, other videos, the deck, and data room folders with access. A runway contradiction stays visible until the founder chooses. |
| 05a / 05b | Work › Rehearsals (allowance, who to practise with, past scores) and Work › The Q Daily (today's edition, sourced, with why each story is shown). |
| 06a–c | Empty state: one calm line and one Q prompt. Loading skeleton: the strip stays and the content is skeleton. Error: says nothing changed, with Try again. |
| 07a–e | Phone 390×844: the tab strip scrolls sideways. **Option A** puts Work first in More. **Option B** has Work replace More in the bar. Founder Pitch on a phone. All three phones side by side. |
| 08a / 08b | Sidebar before and after: Workspace folder against one Work entry. Investor goes from 10 to 7 entries, founder from 12 to 7. |

## Motion (shown in the video)

- **Tab switch:** one underline slides in 140 ms (`--cq-motion-fast`, transform only). The old content fades out in 90 ms and the new content fades in over 200 ms with 8 px of travel. Under reduced motion it is instant, with no slide or fade, and Q's running sweep stops.
- **Sidebar:** hover is a quiet fill. Active has an accent bar and a soft fill, and the waiting count sits beside Work.
- **Reader sheet:** slides in from the right in 360 ms (`--cq-motion-slow`) over the scrim.
- **Approval:** Approve shows "Approving…" at once. "Approved. Q is doing it now." appears only after the server confirms, because approvals are consequential and stay server-confirmed. The item then lands at the top of Done, and the counts on the tab, the sidebar and the phone bar drop by one.

## Design rules held

Square corners (circles only for avatars and dots). No raw colours outside the token block. Glow only on Q's mark. No gradients, eyebrows, badge spam or cards around paragraphs. Controls are at least 44 px. Text pairs come from the preset's contrast-tested tokens. Tabs are built like the CRM `HubNavigation`, with the bold width reserved so the strip never shifts.

## Decisions needed

1. **Approve one "Work" sidebar entry** with tabs Tasks · Documents · (Pitch for founders) · Rehearsals · The Q Daily. Each tab keeps its current address.
2. **Phone:** **A**, Work as the first item in More, or **B**, Work replaces More in the bar (Profile and Settings move to the avatar). A keeps More's existing habits. B puts Work one tap away and shows its count in the bar.

Regenerate: `node design/work-page/capture/screens.mjs`, then `node design/work-page/capture/walkthrough.mjs`, then convert the WebM with ffmpeg (libx264, crf 26, 1280 wide).
