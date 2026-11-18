import type { BoardService } from "@capital-q/board";
import type { PipelineImportTasks } from "@capital-q/network";

/**
 * CRM import (decision 106): a next step from an imported pipeline row
 * becomes a TASK on the importing person's own work board, through the
 * board's own service (its idempotency key makes a re-import add nothing).
 */
export function boardPipelineTasks(
  board: Pick<BoardService, "add">,
): PipelineImportTasks {
  return {
    addTask: async (actor, task, options) => {
      const outcome = await board.add(
        actor,
        {
          kind: "TASK",
          title: task.title,
          notes: task.notes,
          ...(task.dueOn === null ? {} : { dueOn: task.dueOn }),
        },
        {
          by: options.byQ ? "Q" : "PERSON",
          idempotencyKey: options.idempotencyKey,
        },
      );
      return outcome.outcome === "OK" && !outcome.replayed;
    },
  };
}
