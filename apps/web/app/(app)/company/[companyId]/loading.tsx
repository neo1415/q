/**
 * Owner 2026-10-17 (conversation 971c5a53, 11:19 UTC): on Halyard's
 * profile, "open Clearwater Assurance" was rendered on the server three
 * times (api reads done in under 1 s each) and never shown: Q's receipt
 * said NOT_LANDED and they had to ask again. A move between two records
 * of the same page had no loading boundary of its own -- the app's
 * (app)/loading.tsx was already showing content -- so the router could
 * not commit the move until the whole new page had rendered, and while a
 * voice line is live that never settled. From Home (a new segment) the
 * app frame commits at once, which is why moves from Home worked. Each
 * record page now has its own boundary, keyed by the record: the frame
 * commits the move at once and the page streams in behind it.
 */
export { default } from "../../loading";
