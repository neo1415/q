import { QConversationPanel } from "@/features/q/q-conversation";

import { HarnessAppShell } from "./harness-app-shell";

/**
 * The Q page, bare: the real panel, as a bare /home renders it.
 * `?connected=1` dresses it as a signed-in investor's home (suggested
 * questions, the verification starter, the greeting) for screenshots;
 * nothing here reaches Q or a provider.
 */
export default async function QNavQPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const connected = params["connected"] === "1";
  const page = (
    <section aria-label="Ask Q" className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Q</h1>
      {connected ? (
        <QConversationPanel
          connected
          context={{
            scope: "investor_private",
            label: "Personal investing",
            suggestions: [
              "What is my mandate?",
              "What are my hard exclusions?",
              "What should I look at?",
            ],
          }}
          conversationId={null}
          greeting="What's on your mind today, David?"
          starters={[
            {
              id: "verify",
              label: "Verify you and Personal investing",
              icon: "verify",
              kind: "GO",
              href: "/verification",
            },
          ]}
        />
      ) : (
        <QConversationPanel
          connected={false}
          context={{ scope: "unset", suggestions: [] }}
          conversationId={null}
        />
      )}
    </section>
  );
  // `?shell=1` puts the signed-in shell's header and context around it.
  return params["shell"] === "1" ? (
    <HarnessAppShell>{page}</HarnessAppShell>
  ) : (
    page
  );
}
