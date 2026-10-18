import { redirect } from "next/navigation";

/** Merged into the queue page (design-48); kept so old links still work. */
export default function AdminVerificationPage() {
  redirect("/admin/queue?tab=verification");
}
