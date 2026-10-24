/**
 * @capital-q/board
 *
 * Owns: the person's own work board (workspace.board_items and its
 * append-only history), through one service the API and Q both call as the
 * signed-in person. Reads Q's job status only through an injected port.
 */
export {
  createBoardService,
  type BoardChangedBy,
  type BoardJobStatusPort,
  type BoardOutcome,
  type BoardRefusal,
  type BoardService,
} from "./service.js";
