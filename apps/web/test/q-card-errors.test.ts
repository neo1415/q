import { describe, expect, it } from "vitest";

import { ApiProblemError } from "@capital-q/api-client";

import { translate } from "../src/features/i18n/messages";
import { translateQCardError } from "../src/features/q-card/q-card-errors";

const problem = (
  status: number,
  code: string,
  detail?: string,
  requestId = "req_1",
) =>
  new ApiProblemError(
    "failed",
    status,
    code,
    requestId,
    detail === undefined
      ? undefined
      : ({ status, code, detail } as unknown as ConstructorParameters<
          typeof ApiProblemError
        >[4]),
  );

describe("translateQCardError", () => {
  it("shows a refused handle's own reason", () => {
    for (const detail of [
      "That handle isn't available.",
      "That handle is reserved and can't be claimed.",
      "A handle is 3 to 30 lowercase letters, digits or single hyphens, not starting or ending with a hyphen.",
    ]) {
      expect(
        translateQCardError(problem(409, "RESOURCE_CONFLICT", detail)),
      ).toEqual({ ok: false, message: detail });
    }
  });

  it("never reports a rejection without a reason as a taken handle (live 2026-10-23)", () => {
    const result = translateQCardError(
      problem(422, "VALIDATION_FAILED", undefined, "req_42418488"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("handle isn't available");
    expect(result.message).toContain("req_42418488");
    expect(result.message).toContain("Nothing was saved");
  });

  it("keeps the version-conflict, permission and session answers", () => {
    expect(translateQCardError(problem(409, "VERSION_CONFLICT"))).toMatchObject(
      { message: expect.stringContaining("Reload") as unknown },
    );
    expect(translateQCardError(problem(403, "FORBIDDEN"))).toMatchObject({
      message: expect.stringContaining("administrator") as unknown,
    });
    expect(translateQCardError(problem(401, "UNAUTHENTICATED"))).toMatchObject({
      message: expect.stringContaining("Sign in") as unknown,
    });
  });

  it("tells a person their card is theirs alone, and an organisation it needs an administrator", () => {
    expect(
      translateQCardError(problem(403, "PERMISSION_DENIED"), "PERSON"),
    ).toEqual({
      ok: false,
      message: "You can only make or change your own Q Card.",
    });
    expect(
      translateQCardError(problem(403, "PERMISSION_DENIED"), "COMPANY"),
    ).toMatchObject({
      message: expect.stringContaining("administrator") as unknown,
    });
  });

  it("says each refusal in Arabic, keeping the reference as given", () => {
    const refused = translateQCardError(
      problem(422, "VALIDATION_FAILED", undefined, "req_42418488"),
    );
    if (refused.ok) throw new Error("expected a refusal");
    const arabic = translate("ar", refused.message);
    expect(arabic).toContain("لم يُحفظ أي شيء");
    expect(arabic).toContain("req_42418488");
    for (const subject of ["PERSON", "COMPANY"] as const) {
      const denied = translateQCardError(
        problem(403, "PERMISSION_DENIED"),
        subject,
      );
      if (denied.ok) throw new Error("expected a refusal");
      expect(translate("ar", denied.message)).not.toBe(denied.message);
    }
  });

  it("answers an unknown failure without inventing a cause", () => {
    expect(translateQCardError(new Error("boom"))).toEqual({
      ok: false,
      message: "Capital Q couldn't save that just now. Try again.",
    });
  });
});
