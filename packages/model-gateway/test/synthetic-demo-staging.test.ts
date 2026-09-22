import { describe, expect, it } from "vitest";

import {
  createSyntheticDemoRoutingAllowance,
  SyntheticDemoRoutingRefusedError,
} from "../src/index.js";

/**
 * Hosted synthetic staging attestation (QX-004 §0.3; doc 15 §62).
 *
 * The local rule — loopback database, `local` or `test` — was written for
 * a demo stack on somebody's machine. A hosted staging deployment has no
 * loopback database to point at, so it could never attest, and its
 * interview had no eligible model at all the moment one free provider was
 * spent. That is the defect this closes.
 *
 * What it does NOT do, and what these hold it to:
 *
 * **It does not reclassify anything.** A RESTRICTED synthetic payload is
 * still RESTRICTED. Only the question a provider is asked changes, from
 * "may this vendor hold this class of customer data" to "is there a
 * customer here at all", and only where the deployment has independently
 * said there is not.
 *
 * **The environment alone is never the proof.** Staging must also carry an
 * explicit attestation AND name the synthetic Supabase project, and that
 * project must be the one actually in use — so a staging service repointed
 * at a real database stops attesting at startup instead of routing.
 *
 * **Production cannot hold it at all.** An attestation there is a
 * configuration mistake that stops the process.
 */

const SYNTHETIC_REF = "vcohxiqsmnkzxnvawgri";
const OTHER_REF = "abcdefghijklmnopqrst";

const pooled = (ref: string) =>
  `postgresql://postgres.${ref}:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;
const direct = (ref: string) =>
  `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`;
const LOOPBACK = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("QX-004 §0.3 · hosted synthetic staging attestation", () => {
  it("1: a local demo still attests through its loopback database", () => {
    const allowance = createSyntheticDemoRoutingAllowance({
      operatorEnabled: true,
      environment: "local",
      databaseUrl: LOOPBACK,
    });
    expect(allowance?.permitted).toBe(true);
    expect(allowance?.attestation).toContain("environment local");
  });

  it("2: hosted staging attests when it names the synthetic project it is using", () => {
    for (const url of [pooled(SYNTHETIC_REF), direct(SYNTHETIC_REF)]) {
      const allowance = createSyntheticDemoRoutingAllowance({
        operatorEnabled: true,
        environment: "staging",
        databaseUrl: url,
        hostedAttested: true,
        syntheticProjectRef: SYNTHETIC_REF,
        supabaseUrl: `https://${SYNTHETIC_REF}.supabase.co`,
      });
      expect(allowance?.permitted).toBe(true);
      expect(allowance?.attestation).toContain("deployment attested synthetic");
      expect(allowance?.attestation).toContain(
        `supabase project ${SYNTHETIC_REF}`,
      );
    }
  });

  it("3: staging without the explicit attestation is not synthetic", () => {
    expect(() =>
      createSyntheticDemoRoutingAllowance({
        operatorEnabled: true,
        environment: "staging",
        databaseUrl: pooled(SYNTHETIC_REF),
        syntheticProjectRef: SYNTHETIC_REF,
      }),
    ).toThrow(SyntheticDemoRoutingRefusedError);
    // And naming nothing is not an attestation either.
    expect(() =>
      createSyntheticDemoRoutingAllowance({
        operatorEnabled: true,
        environment: "staging",
        databaseUrl: pooled(SYNTHETIC_REF),
        hostedAttested: true,
      }),
    ).toThrow(SyntheticDemoRoutingRefusedError);
  });

  it("4: a staging service pointed at another project stops attesting", () => {
    // The whole point of naming the project rather than setting a boolean:
    // this is the accident the boolean could not catch.
    expect(() =>
      createSyntheticDemoRoutingAllowance({
        operatorEnabled: true,
        environment: "staging",
        databaseUrl: pooled(OTHER_REF),
        hostedAttested: true,
        syntheticProjectRef: SYNTHETIC_REF,
      }),
    ).toThrow(SyntheticDemoRoutingRefusedError);
    // Including when only one of the two identifiers has moved.
    expect(() =>
      createSyntheticDemoRoutingAllowance({
        operatorEnabled: true,
        environment: "staging",
        databaseUrl: pooled(SYNTHETIC_REF),
        hostedAttested: true,
        syntheticProjectRef: SYNTHETIC_REF,
        supabaseUrl: `https://${OTHER_REF}.supabase.co`,
      }),
    ).toThrow(SyntheticDemoRoutingRefusedError);
    // And when nothing identifiable can be read at all.
    expect(() =>
      createSyntheticDemoRoutingAllowance({
        operatorEnabled: true,
        environment: "staging",
        databaseUrl: "postgresql://user:pw@db.elsewhere.example.com:5432/x",
        hostedAttested: true,
        syntheticProjectRef: SYNTHETIC_REF,
      }),
    ).toThrow(SyntheticDemoRoutingRefusedError);
  });

  it("5: production carrying the attestation stops the process", () => {
    for (const environment of ["production", "preview"]) {
      expect(() =>
        createSyntheticDemoRoutingAllowance({
          operatorEnabled: true,
          environment,
          databaseUrl: pooled(SYNTHETIC_REF),
          hostedAttested: true,
          syntheticProjectRef: SYNTHETIC_REF,
        }),
      ).toThrow(SyntheticDemoRoutingRefusedError);
      // Even with the routing opt-in absent: a deployment that believes it
      // is synthetic and serves real people must not start at all.
      expect(() =>
        createSyntheticDemoRoutingAllowance({
          operatorEnabled: false,
          environment,
          databaseUrl: pooled(SYNTHETIC_REF),
          hostedAttested: true,
          syntheticProjectRef: SYNTHETIC_REF,
        }),
      ).toThrow(SyntheticDemoRoutingRefusedError);
    }
  });

  it("6: an operator who has not opted in gets no allowance, quietly", () => {
    expect(
      createSyntheticDemoRoutingAllowance({
        operatorEnabled: false,
        environment: "staging",
        databaseUrl: pooled(SYNTHETIC_REF),
        syntheticProjectRef: SYNTHETIC_REF,
      }),
    ).toBeNull();
  });
});
