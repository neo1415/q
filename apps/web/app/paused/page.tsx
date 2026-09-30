import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { buttonClassName } from "@capital-q/ui/button";

import { signOutAction } from "@/auth/actions";
import { requireSessionUser } from "@/auth/session";
import { resolveQStanding } from "@/features/q/context";

export const metadata: Metadata = { title: "Account paused" };
export const dynamic = "force-dynamic";

/**
 * An account Q paused (founder direction 2026-09-30): after five times
 * being sent to look around instead of finishing the setup. A person at
 * Capital Q has been told and reinstates it; until then this is all the
 * account sees. Anyone not paused is sent on.
 */
export default async function PausedPage() {
  await requireSessionUser();
  const standing = await resolveQStanding();
  if (standing !== null && !standing.paused) redirect("/welcome");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-10">
      <h1 className="cq-title-lg text-(--cq-text-primary)">
        Your account is paused
      </h1>
      <p className="cq-body text-(--cq-text-secondary)">
        Q paused your account after the setup was set aside a few times. Someone
        from the Capital Q team has been told and will be in touch to get you
        going again.
      </p>
      <form action={signOutAction}>
        <button type="submit" className={buttonClassName("secondary")}>
          Sign out
        </button>
      </form>
    </main>
  );
}
