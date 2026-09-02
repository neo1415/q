import { redirect } from "next/navigation";

/** The application has no landing page; the product starts at Home. */
export default function RootPage(): never {
  redirect("/home");
}
