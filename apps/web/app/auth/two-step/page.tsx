import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveSecondStepReturn } from "@/auth/second-step";
import { getSecondStepUser, getSessionUser } from "@/auth/session";
import { TwoStepForm } from "@/features/auth";

export const metadata: Metadata = { title: "Two-step verification" };

/**
 * Who this page serves is decided here, on the server: a session that has
 * passed its first step and owes its code. Nobody signed in goes to
 * sign-in; somebody who owes nothing (aal2 already, or no authenticator)
 * goes straight on.
 */
export default async function TwoStepPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = resolveSecondStepReturn((await searchParams)["next"]);

  if ((await getSecondStepUser()) === null) {
    redirect((await getSessionUser()) === null ? "/auth/sign-in" : next);
  }

  return <TwoStepForm next={next} />;
}
