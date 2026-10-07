/** A fit.profile tool outcome, as the fit tool returns it (test fixture). */
const PARAMETERS = [
  "STAGE",
  "SECTOR",
  "GEOGRAPHY",
  "CHEQUE_SIZE",
  "BUSINESS_MODEL",
  "TRACTION",
  "TEAM",
  "THESIS",
  "ROUND_TERMS",
] as const;

export function fitFixture(
  companyId: string,
  name: string,
  outcomes: Partial<Record<(typeof PARAMETERS)[number], string>>,
  band: "STRONG_FIT" | "GOOD_FIT" | "PARTIAL_FIT" = "GOOD_FIT",
): { toolName: "fit.profile"; result: { ok: true; data: unknown } } {
  const parameters = PARAMETERS.map((parameter) => ({
    parameter,
    outcome: outcomes[parameter] ?? "UNKNOWN",
    reason: `${parameter.toLowerCase().replace("_", " ")} ${
      (outcomes[parameter] ?? "UNKNOWN") === "STRONG"
        ? "is within your mandate"
        : (outcomes[parameter] ?? "UNKNOWN") === "MISMATCH"
          ? "is outside your mandate"
          : "is not known yet"
    }`,
    evidenceStatus: null,
    stale: false,
    applicable: true,
  }));
  return {
    toolName: "fit.profile",
    result: {
      ok: true,
      data: {
        status: "OK",
        name,
        profile: {
          companyId,
          configVersion: "ranking-config.v4",
          configLabel: "v4",
          band,
          confidence: "MEDIUM",
          parameters,
          topReasons: parameters
            .filter((p) => p.outcome === "STRONG")
            .slice(0, 3),
          mainMismatch:
            parameters.find((p) => p.outcome === "MISMATCH") ?? null,
          hardRule: null,
          computedAt: "2026-10-07T20:24:45.000Z",
        },
        text: "",
        guidance: "",
      },
    },
  };
}
