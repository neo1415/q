import type { Metadata } from "next";

import { requireSessionUser } from "@/auth/session";
import { UpdatePasswordForm } from "@/features/auth";

export const metadata: Metadata = { title: "New password" };

/**
 * Reached from the recovery callback, which established a session for the
 * person who opened the emailed link. No session, no form.
 */
export default async function UpdatePasswordPage() {
  await requireSessionUser("/auth/update-password");
  return <UpdatePasswordForm />;
}
