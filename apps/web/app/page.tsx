import { redirect } from "next/navigation";

/**
 * The application has no landing page. Arrival decides where it starts:
 * Q's onboarding for anybody not yet onboarded (founder direction
 * 2026-09-30), Discover for everybody else (founder directive 2026-09-27).
 */
export default function RootPage(): never {
  redirect("/welcome");
}
