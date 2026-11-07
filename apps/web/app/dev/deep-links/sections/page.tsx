import { QSection } from "@/features/q/q-section";

const SECTIONS = [
  ["overview", "Overview"],
  ["raise", "The raise"],
  ["readiness", "Readiness"],
  ["commitments", "Commitments"],
  ["deck-views", "Deck views"],
] as const;

/** Real QSection markers on a long page (`#section-<id>` lands on one). */
export default function HarnessSections() {
  return (
    <>
      <h1 className="cq-title-md text-(--cq-text-primary)">Capital</h1>
      {SECTIONS.map(([id, title]) => (
        <QSection key={id} id={id} kind="OTHER">
          <section className="flex min-h-[70vh] flex-col gap-2 py-6">
            <h2 className="cq-title-sm text-(--cq-text-primary)">{title}</h2>
            <p className="cq-body text-(--cq-text-secondary)">
              Fictional content for {title.toLowerCase()}.
            </p>
          </section>
        </QSection>
      ))}
    </>
  );
}
