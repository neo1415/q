import { resolveHomeQ } from "@/features/home/home-screen";

import { AfterHydration } from "./after-hydration";
import {
  LazyArrivalStage,
  LazyQConversationPanel,
} from "./workspace-q-pane-lazy";
import { WorkspaceQPending } from "./workspace-q-pending";

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
      <LazyQConversationPanel
        workspace
        connected={home.qConnected}
        context={home.surface}
        greeting={home.greeting}
        starters={home.starters}
        welcomeLine={home.welcomeLine}
        welcomeLead={home.welcomeLead}
        briefing={home.briefing}
        stageLayer={home.returning ? <LazyArrivalStage /> : undefined}
      />
    </AfterHydration>
  );
}

export { WorkspaceQPending } from "./workspace-q-pending";
