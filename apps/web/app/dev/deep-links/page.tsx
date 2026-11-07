/** The hub: where the person is before a deep link or Q's move. */
export default function DeepLinksHub() {
  return (
    <section className="flex flex-col gap-3" data-harness-hub>
      <h1 className="cq-title-md text-(--cq-text-primary)">Deep links</h1>
      <p className="cq-body text-(--cq-text-secondary)">
        Every link above lands on one element and marks it.
      </p>
    </section>
  );
}
