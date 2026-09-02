import type { ReactNode } from "react";
import { CONTRACTS_VERSION } from "@capital-q/contracts";

/**
 * Deliberately unstyled. The Capital Q visual system is defined in
 * docs/architecture/17 and 18 and is implemented by the Web track; introducing
 * placeholder visual language here would only have to be undone.
 */
export default function Page(): ReactNode {
  return (
    <main>
      <h1>Capital Q</h1>
      {process.env.NODE_ENV === "development" ? (
        <p>Web application running. Contracts {CONTRACTS_VERSION}.</p>
      ) : null}
    </main>
  );
}
