import type { Metadata } from "next";
import Link from "next/link";

import { linkClassName } from "@capital-q/ui/link";

import { AuthHeading } from "@/features/auth";

export const metadata: Metadata = { title: "Check your email" };

/**
 * One page for every "we sent you something" moment. The wording never
 * confirms whether an account exists: the recovery variant says the same
 * thing for a known and an unknown address.
 */
const PURPOSES: Record<string, { title: string; description: string }> = {
  confirm: {
    title: "Check your email",
    description:
      "We sent a link to confirm your address. Open it on this device to finish creating your account.",
  },
  link: {
    title: "Check your email",
    description:
      "We sent you a sign-in link. Open it on this device to continue.",
  },
  recovery: {
    title: "Check your email",
    description:
      "If an account exists for that address, we've sent a link to choose a new password.",
  },
};

const DEFAULT_PURPOSE = {
  title: "Check your email",
  description: "Open the link we sent you on this device to continue.",
};

export default async function CheckEmailPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const purpose = params["purpose"];
  const copy =
    (typeof purpose === "string" ? PURPOSES[purpose] : undefined) ??
    DEFAULT_PURPOSE;

  return (
    <div className="flex flex-col gap-8">
      <AuthHeading title={copy.title} description={copy.description} />
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Didn&apos;t get it? Check your spam folder, or{" "}
        <Link href="/auth/sign-in" className={linkClassName()}>
          go back to sign in
        </Link>
        .
      </p>
    </div>
  );
}
