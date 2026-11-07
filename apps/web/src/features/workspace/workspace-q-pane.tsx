import { ArrivalStage } from "@/features/briefing/arrival-stage";
import { resolveHomeQ } from "@/features/home/home-screen";
import { QConversationPanel } from "@/features/q/q-conversation";

import { AfterHydration } from "./after-hydration";

/**
 * The Q pane's conversation (W1.2): Home's Q, rendered once by the layout.
 * A layout is not re-rendered on client navigation, so the panel, the
 * conversation, the voice line and the composer survive every page move.
 * Which conversation is open is the session store's (the one QSessionProvider);
 * `/home?c=` and `?new=1` ask it from the page (WorkspaceHomeDirective).
 */
export async function WorkspaceQConversation() {
  const home = await resolveHomeQ(null);
  // The conversation is the browser's (this tab's session store), so the
  // panel is drawn after hydration; the server sends the pane's shape.
  return (
    <AfterHydration fallback={<WorkspaceQPending />}>
      <QConversationPanel
        workspace
        connected={home.qConnected}
        context={home.surface}
        greeting={home.greeting}
        starters={home.starters}
        welcomeLine={home.welcomeLine}
        welcomeLead={home.welcomeLead}
        briefing={home.briefing}
        stageLayer={home.returning ? <ArrivalStage /> : undefined}
      />
    </AfterHydration>
  );
}

/** The pane's shape while Q's first read lands; no spinner. */
export function WorkspaceQPending() {
  return (
    <div
      className="cq-stage cq-q-pane gap-3 p-4"
      aria-busy="true"
      data-q-pane-pending
    >
      <div className="mt-auto h-12 w-full rounded-md bg-(--cq-stage-surface-strong)" />
    </div>
  );
}
