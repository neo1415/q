import { redirect } from "next/navigation";

/**
 * The application has no landing page; the product starts at Discover
 * (founder directive, 2026-09-27). Q stays one tap away: the dock, and the
 * Q tab at /home (also reachable as /q).
 */
export default function RootPage(): never {
  redirect("/discover");
}
