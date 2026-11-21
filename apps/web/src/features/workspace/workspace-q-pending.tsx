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
