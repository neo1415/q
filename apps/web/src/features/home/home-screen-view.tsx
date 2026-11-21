import { ArrivalStage } from "@/features/briefing/arrival-stage";
import { serverT } from "@/features/i18n/server";
import { QConversationPanel } from "@/features/q/q-conversation";
import { QSection } from "@/features/q/q-section";

import { resolveHomeQ } from "./home-screen";

// W4-B (audit finding 6): Home's page, moved verbatim out of
// ./home-screen.tsx so the app layout, which needs only resolveHomeQ for
// the Q pane, no longer pulls the conversation's code into every page.

export async function HomeScreen({
  conversationId = null,
  fresh = false,
  openBoard = false,
  ask,
}: {
  /**
   * Lane ov 2026-10-16: words to start the composer with ("Ask Q about
   * their market", a profile section to tell Q about). Only typed for
   * them; nothing is sent until they press Send.
   */
  readonly ask?: string | undefined;
  /** The conversation the URL names, resolved on the server. */
  readonly conversationId?: string | null | undefined;
  /** "New chat" (`?new=1`): a new conversation; a bare /home keeps this tab's. */
  readonly fresh?: boolean | undefined;
  /** Arrived from the answer chip's Board (C6): open on the Board. */
  readonly openBoard?: boolean | undefined;
} = {}) {
  const [t, home] = await Promise.all([
    serverT(),
    resolveHomeQ(conversationId),
  ]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        The Q surface. Deliberately not a PageHeader and a card: a heading
        reading "Home" above a boxed chat is the dashboard composition
        this packet exists to replace. Previous conversations are one
        control away (the history control here, the collapsible list in
        the sidebar), never a list above the composer.

        Deliberately not inside a Suspense boundary (QX-003A): React
        reveals a streamed boundary on a requestAnimationFrame, which never
        fires in a hidden tab, and Home's whole Q surface stayed blank in a
        background tab until it was removed.
      */}
      {/*
        Owner 2026-11-06 (asked twice): no "Q is working on N things"
        panel on Home. Running work is on the Board (its count is on the
        top line) and on /work; WorkPanel itself is unchanged there.
      */}
      <section
        aria-label={t("Ask Q")}
        className="flex min-h-0 flex-1 flex-col"
        data-q-surface
      >
        {/* A conversation view still has a page heading (R30 #34). */}
        <h1 className="sr-only">Q</h1>
        {/* Q Workspace W2: the conversation, a section Q can name. */}
        <QSection id="q" kind="OTHER" label={t("Ask Q")} />
        <QConversationPanel
          connected={home.qConnected}
          context={home.surface}
          conversationId={conversationId}
          fresh={fresh}
          openBoard={openBoard}
          greeting={home.greeting}
          starters={home.starters}
          welcomeLine={home.welcomeLine}
          welcomeLead={home.welcomeLead}
          briefing={home.briefing}
          // E1: what Q did, what needs them and new matches, beside Q for
          // as long as the page lives (not only before the first word).
          stageLayer={home.returning ? <ArrivalStage /> : undefined}
          initialAsk={ask}
        />
      </section>
    </div>
  );
}
