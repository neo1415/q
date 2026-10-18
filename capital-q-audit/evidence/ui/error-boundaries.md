# Evidence: apps/web/app/error.tsx (lines 1-59)

- Original path: `apps/web/app/error.tsx`
- Line range: 1-59 (HEAD 520bd123)
- Why included: Only error boundary for the app: root level; no (app)-segment error.tsx (see find output in 11-UI-UX-ARCHITECTURE.md).

```
    1  "use client";
    2
    3  import { useEffect } from "react";
    4
    5  import { Button, buttonClassName } from "@capital-q/ui/button";
    6
    7  import { StatusPage } from "@/components/status-page";
    8
    9  /**
   10   * A page that failed to render. The commonest cause on a live site is a
   11   * deploy landing mid-visit: the page asks for a script the new build no
   12   * longer has (a ChunkLoadError). Loading the page again fetches the new
   13   * build, so that case reloads the document rather than retrying in place.
   14   */
   15  function isStaleBuild(error: Error): boolean {
   16    return (
   17      error.name === "ChunkLoadError" ||
   18      /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(
   19        error.message,
   20      )
   21    );
   22  }
   23
   24  export default function PageError({
   25    error,
   26    reset,
   27  }: {
   28    readonly error: Error & { readonly digest?: string };
   29    readonly reset: () => void;
   30  }) {
   31    const stale = isStaleBuild(error);
   32    useEffect(() => {
   33      // The digest only: a message can carry user data.
   34      console.error("page error", error.digest ?? error.name);
   35    }, [error]);
   36    return (
   37      <StatusPage
   38        title={stale ? "Capital Q was just updated." : "This page couldn't load."}
   39        description={
   40          stale
   41            ? "Reload to get the latest version. Nothing you saved is lost."
   42            : "Capital Q hit a problem loading this page. Nothing you saved is lost; try again in a moment."
   43        }
   44      >
   45        <Button
   46          variant="primary"
   47          onClick={() => {
   48            if (stale) window.location.reload();
   49            else reset();
   50          }}
   51        >
   52          {stale ? "Reload" : "Try again"}
   53        </Button>
   54        <a href="/home" className={buttonClassName("secondary")}>
   55          Go to Home
   56        </a>
   57      </StatusPage>
   58    );
   59  }
```

# Evidence: apps/web/src/features/q/q-conversation.tsx (lines 699-741)

- Original path: `apps/web/src/features/q/q-conversation.tsx`
- Line range: 699-741 (HEAD 520bd123)
- Why included: Stage notices: transport reconnecting, run failure, notice, voice notice, blocked speech.

```
  699    // Notices that belong wherever the conversation is: the stage before it
  700    // starts, the end of the thread once it has.
  701    const notices = (
  702      <>
  703        {q.transport === "RECONNECTING" ? (
  704          <p className="cq-caption text-(--cq-text-secondary)">
  705            {describeQStreamTransport(q.transport)} Your conversation is saved.
  706          </p>
  707        ) : null}
  708        {q.state.failure !== null ? (
  709          <StageNotice title="Q couldn't finish that">
  710            {failureMessage(q.state.failure)} {recoveryHint(q.state.failure)}
  711          </StageNotice>
  712        ) : null}
  713        {q.notice !== null && q.state.failure === null ? (
  714          <StageNotice title="That didn't go through">{q.notice}</StageNotice>
  715        ) : null}
  716        {voice.notice !== null ? (
  717          <div className="flex items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3">
  718            <span className="cq-body text-(--cq-text-primary)">
  719              {voice.notice}
  720            </span>
  721            <button
  722              type="button"
  723              className="cq-stage-quiet"
  724              onClick={voice.clearNotice}
  725            >
  726              Dismiss
  727            </button>
  728          </div>
  729        ) : null}
  730        {speech.status === "blocked" ? (
  731          <button
  732            type="button"
  733            className="cq-stage-control"
  734            onClick={speech.play}
  735          >
  736            Play Q’s answer
  737          </button>
  738        ) : null}
  739      </>
  740    );
  741
```
