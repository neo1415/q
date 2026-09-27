import type { ReactNode } from "react";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";

/**
 * A whole-page status (not found, something failed): the wordmark, one
 * heading, one plain sentence and a way forward. Rendered outside the app
 * shell because it must work when the shell is what failed; it reads the
 * design tokens only, so it follows the theme like every page.
 */
export function StatusPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-reading) flex-col justify-center gap-6 px-4 py-10">
      <a
        href="/home"
        className="-mx-2 flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
      >
        <QNavIcon
          size={18}
          strokeWidth={2}
          aria-hidden="true"
          className="text-(--cq-accent)"
        />
        <span className="cq-label">Capital Q</span>
      </a>
      <div className="flex flex-col gap-2">
        <h1 className="cq-title-xl text-(--cq-text-primary)">{title}</h1>
        <p className="cq-body text-(--cq-text-secondary)">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </main>
  );
}
