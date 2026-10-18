import { redirect } from "next/navigation";

/**
 * Your companies is Discover's own tab now (follow-55; founder decision
 * 2026-10-04: "For you" and "Your companies" at the top of Discover). The
 * old address keeps working and lands on that tab.
 */
export default function YourCompaniesPage(): never {
  redirect("/discover?tab=yours");
}
