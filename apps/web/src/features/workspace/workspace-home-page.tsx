import { PageContainer } from "@/components/app-shell/page-container";
import { listBoardAction } from "@/features/board/board-actions";
import { WorkBoard } from "@/features/board/work-board";
import { resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";
import { WorkHeader, workSideOf } from "@/features/work/work-header";

/**
 * `/home`'s page pane in the Q Workspace (W1.2; ADR 0077): Q is already the
 * pane beside it, so the page side shows the person's work board, the same
 * reads and component as `/board`. Collapsing the page pane leaves Q alone.
 */
export async function WorkspaceHomePage() {
  const t = await serverT();
  const [board, context] = await Promise.all([
    listBoardAction().catch(() => null),
    resolveOwnContext().catch(() => null),
  ]);
  return (
    <PageContainer>
      <h1 className="sr-only">{t("Home")}</h1>
      <WorkHeader view="board" side={workSideOf(context)} />
      <QSection id="board" kind="WORK_LIST" label={t("your board")}>
        <WorkBoard initial={board?.ok === true ? board.value.items : null} />
      </QSection>
    </PageContainer>
  );
}
