import { redirect } from "next/navigation";

/**
 * The root sends everyone into the app's arrival (sign-in, onboarding or
 * the Q page). The landing page (src/features/landing) is held back until
 * its visual redo is approved (founder 2026-10-04); the request proxy still
 * sends signed-in and installed launches straight in.
 */
export default function RootPage(): never {
  redirect("/welcome");
}
