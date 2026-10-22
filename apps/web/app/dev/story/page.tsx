/**
 * The harness's Home: the quiet Q stage the story opens and ends on. Its
 * note is for screen readers only, so it never appears in a recording.
 */
export default function StoryHarnessHome() {
  return (
    <main className="cq-q-home grid min-h-dvh place-items-center bg-(--cq-canvas) px-4">
      <p className="sr-only">Q Story: fictional data, no service is read.</p>
    </main>
  );
}
