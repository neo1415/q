import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MoneySchema } from "../src/common/money.js";
import {
  ContractValidationError,
  parseContract,
  toValidationIssues,
  ValidationIssueSchema,
} from "../src/common/validation.js";

// Synthetic only. Never a real credential.
const SYNTHETIC_SECRET = "super-secret-test-token";

describe("ValidationIssueSchema", () => {
  it("describes where and what, and nothing else", () => {
    const issue = {
      path: "amount",
      code: "invalid_format",
      message: "expected an exact decimal string",
    };

    expect(ValidationIssueSchema.parse(issue)).toEqual(issue);
  });

  it("requires a non-empty code and message", () => {
    expect(
      ValidationIssueSchema.safeParse({ path: "a", code: "", message: "m" })
        .success,
    ).toBe(false);
  });

  it("allows an empty path for a root-level failure", () => {
    expect(
      ValidationIssueSchema.safeParse({ path: "", code: "c", message: "m" })
        .success,
    ).toBe(true);
  });
});

describe("toValidationIssues", () => {
  it("maps a Zod error to dotted paths and stable codes", () => {
    const result = MoneySchema.safeParse({ amount: "1e6", currency: "usd" });
    expect(result.success).toBe(false);

    const issues = toValidationIssues((result as { error: z.ZodError }).error);

    expect(issues.map((issue) => issue.path).sort()).toEqual([
      "amount",
      "currency",
    ]);
    for (const issue of issues) {
      expect(issue.code.length).toBeGreaterThan(0);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it("reports nested paths in dotted form", () => {
    const schema = z.object({ payment: MoneySchema });
    const result = schema.safeParse({
      payment: { amount: "nope", currency: "USD" },
    });

    const issues = toValidationIssues((result as { error: z.ZodError }).error);
    expect(issues[0]?.path).toBe("payment.amount");
  });

  it("never echoes the rejected value", () => {
    // A validation failure is often the first thing written to a log or error
    // tracker. Echoing the input there is how secrets escape.
    const schema = z.object({ token: z.uuid() });
    const result = schema.safeParse({ token: SYNTHETIC_SECRET });

    const issues = toValidationIssues((result as { error: z.ZodError }).error);
    const serialised = JSON.stringify(issues);

    expect(serialised).not.toContain(SYNTHETIC_SECRET);
  });
});

describe("parseContract", () => {
  it("returns the parsed value on success", () => {
    expect(
      parseContract(MoneySchema, { amount: "10.00", currency: "USD" }),
    ).toEqual({ amount: "10.00", currency: "USD" });
  });

  it("throws a transport-neutral error carrying safe issues", () => {
    let caught: unknown;
    try {
      parseContract(MoneySchema, { amount: "1e6", currency: "USD" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContractValidationError);
    const error = caught as ContractValidationError;

    expect(error.name).toBe("ContractValidationError");
    expect(error.issues.length).toBeGreaterThan(0);

    // Transport mapping belongs to CQ-CON-002: no status, no problem type URI,
    // no wire error code lives on this error.
    expect(error).not.toHaveProperty("status");
    expect(error).not.toHaveProperty("statusCode");
    expect(error).not.toHaveProperty("type");
  });

  it("does not leak the submitted value through the thrown error", () => {
    let caught: unknown;
    try {
      parseContract(z.object({ apiKey: z.uuid() }), {
        apiKey: SYNTHETIC_SECRET,
      });
    } catch (error) {
      caught = error;
    }

    const error = caught as ContractValidationError;
    expect(error.message).not.toContain(SYNTHETIC_SECRET);
    expect(JSON.stringify(error.issues)).not.toContain(SYNTHETIC_SECRET);
  });

  it("does not expose the raw Zod error as the public representation", () => {
    let caught: unknown;
    try {
      parseContract(MoneySchema, {});
    } catch (error) {
      caught = error;
    }

    // Callers couple to Capital Q's issue shape, not to Zod's internals.
    expect(caught).not.toBeInstanceOf(z.ZodError);
    for (const issue of (caught as ContractValidationError).issues) {
      expect(Object.keys(issue).sort()).toEqual(["code", "message", "path"]);
    }
  });
});
