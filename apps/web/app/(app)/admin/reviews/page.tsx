import { redirect } from "next/navigation";

/** Merged into the queue page (design-48); kept so old links still work. */
export default async function AdminReviewsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly all?: string | undefined }>;
}) {
  const all = (await searchParams).all === "1";
  redirect(all ? "/admin/queue?tab=reviews&all=1" : "/admin/queue?tab=reviews");
}
