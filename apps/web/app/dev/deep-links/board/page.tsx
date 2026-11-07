import { WorkBoard } from "@/features/board/work-board";
import { QSection } from "@/features/q/q-section";

import { harnessBoard } from "../fixtures";

/** The real work board over fictional items (`?item=` lands on one). */
export default function HarnessBoard() {
  return (
    <>
      <h1 className="cq-title-md text-(--cq-text-primary)">Board</h1>
      <QSection id="board" kind="WORK_LIST">
        <WorkBoard initial={harnessBoard()} />
      </QSection>
    </>
  );
}
