import type { Metadata } from "next";

import { PageContainer } from "@/components/app-shell/page-container";
import { listBoardAction } from "@/features/board/board-actions";
import { WorkBoard } from "@/features/board/work-board";
import { resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";
import { WorkHeader, workSideOf } from "@/features/work/work-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Board") };
}

export const dynamic = "force-dynamic";

/**
 * The work board (owner 2026-10-23), a Work tab: the person's own
 * documents, companies, tasks, notes and Q's work, in To do, Doing and
 * Done. Read on the server as the person; Q reads and changes the same
 * board with my_board.
 */
export default async function BoardPage() {
  const t = await serverT();
  const [board, context] = await Promise.all([
    listBoardAction().catch(() => null),
    // The shell already read this for the request; React's cache shares it.
    resolveOwnContext().catch(() => null),
  ]);
  return (
    <PageContainer>
      <WorkHeader view="board" side={workSideOf(context)} />
      <QSection id="board" kind="WORK_LIST" label={t("your board")}>
        <WorkBoard initial={board?.ok === true ? board.value.items : null} />
      </QSection>
    </PageContainer>
  );
}
