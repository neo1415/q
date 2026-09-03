import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Every auth page reads the request (cookies, search params) and is never
// prerendered or shared-cached.
export const dynamic = "force-dynamic";

/**
 * The authentication frame: wordmark, one column, nothing else. No
 * application shell, no primary navigation, no organisation context -- a
 * signed-out visitor has none of those, and the surface should be as light
 * as a sign-in on a phone can be.
 */
export default function AuthLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div className="cq-auth">
      <header className="cq-auth-header">
        <Link
          href="/"
          className="cq-title-md rounded-xs text-(--cq-text-primary)"
        >
          Capital Q
        </Link>
      </header>
      <main id="main" className="cq-auth-main">
        {children}
      </main>
    </div>
  );
}
