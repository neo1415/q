/**
 * The auth surface says one thing at a time: a short title and, when needed,
 * one sentence. No marketing panel, no feature list, no badges.
 */
export function AuthHeading({
  title,
  description,
}: {
  readonly title: string;
  readonly description?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="cq-title-xl text-(--cq-text-primary)">{title}</h1>
      {description !== undefined ? (
        <p className="cq-body text-(--cq-text-secondary)">{description}</p>
      ) : null}
    </div>
  );
}
