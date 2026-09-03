import type { Metadata } from "next";

import { resolveSafeReturnPath } from "@/auth/redirect-safety";
import { SignInForm, type SignInNotice } from "@/features/auth";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Server-authored notices only; the query string chooses from this list. */
const NOTICES: Record<string, SignInNotice> = {
  "signed-out": { tone: "info", message: "You're signed out." },
  "link-invalid": {
    tone: "warning",
    message: "That link has expired or was already used. Request a new one.",
  },
};

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = resolveSafeReturnPath(params["next"]);
  const noticeKey = params["notice"];
  const notice = typeof noticeKey === "string" ? NOTICES[noticeKey] : undefined;

  return <SignInForm next={next} notice={notice} />;
}
