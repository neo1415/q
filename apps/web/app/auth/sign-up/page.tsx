import type { Metadata } from "next";

import { resolveSafeReturnPath } from "@/auth/redirect-safety";
import { SignUpForm } from "@/features/auth";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <SignUpForm next={resolveSafeReturnPath(params["next"])} />;
}
