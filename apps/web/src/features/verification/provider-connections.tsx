import type { VerificationProviderConnectionDto } from "@capital-q/contracts";

/**
 * V1 (decision 113): which verification providers are connected on this
 * deployment, said plainly. A provider that is not connected is named as
 * not connected: nothing on screen implies an automatic check ran through
 * it. Names and coverage only; never a key.
 */
export function ProviderConnections({
  t,
  providers,
  heading,
}: {
  readonly t: (english: string) => string;
  readonly providers: readonly VerificationProviderConnectionDto[];
  readonly heading: string;
}) {
  if (providers.length === 0) return null;
  return (
    <section
      aria-label={heading}
      className="mt-6 flex flex-col gap-2"
      data-verification-providers=""
    >
      <h2 className="m-0 text-sm font-medium text-(--cq-text-primary)">
        {heading}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {providers.map((provider) => (
          <li
            key={provider.provider}
            className="flex flex-col gap-0.5 text-sm"
            data-provider={provider.provider}
            data-connected={provider.connected ? "yes" : "no"}
          >
            <span className="text-(--cq-text-primary)">
              {t(provider.label)}
              {" · "}
              <span className="text-(--cq-text-secondary)">
                {provider.connected ? t("Connected") : t("Not connected")}
              </span>
            </span>
            <span className="text-(--cq-text-secondary)">
              {t(provider.covers)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
