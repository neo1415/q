import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmAccountApplicationContact,
  confirmApplicationContact,
  getApplicationCoverage,
  getApplicationTranscript,
  resumeApplication,
  saveApplicationContact,
} from "../src/gateq.js";
const token = "gqs_application_12345678901234567890";
const base = "https://api.example.test";
const contact = {
  name: "Amara",
  email: "amara@example.test",
  role: "Founder",
  companyName: "Kora",
};
const contactDto = {
  ...contact,
  phone: null,
  preferredChannel: null,
  emailConfirmed: false,
  confirmedVia: null,
};
const summary = {
  reference: "ga_same",
  status: "IN_PROGRESS",
  declaredName: "Kora",
  facts: [],
  documentCount: 0,
  submittedAt: null,
  access: "MAY_APPLY",
  unmet: [],
  stillNeeded: [],
};
function respond(body: unknown) {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
describe("application-scoped GateQ client", () => {
  it("saves contact using the application bearer and validates the contact input", async () => {
    const fetcher = respond({
      contact: contactDto,
      codeSent: true,
      codeExpiresInMinutes: 10,
    });
    await saveApplicationContact(base, token, contact);
    expect(fetcher).toHaveBeenCalledWith(
      `${base}/v1/gateq/apply/contact`,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(contact),
      }),
    );
    expect(() =>
      saveApplicationContact(base, token, { ...contact, email: "invalid" }),
    ).toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("confirms account ownership with the actor credential and scopes the application in the body", async () => {
    const fetcher = respond({
      contact: { ...contactDto, emailConfirmed: true, confirmedVia: "ACCOUNT" },
      codeSent: false,
      codeExpiresInMinutes: null,
    });
    await confirmAccountApplicationContact(
      { baseUrl: base, accessToken: "actor-token" },
      { ...contact, sessionToken: token },
    );
    expect(fetcher).toHaveBeenCalledWith(
      `${base}/v1/gateq/apply/contact/account`,
      expect.objectContaining({
        headers: {
          accept: "application/json",
          authorization: "Bearer actor-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...contact, sessionToken: token }),
      }),
    );
  });
  it("returns confirmation refusal without treating it as confirmed", async () => {
    respond({ status: "WRONG_CODE", contact: null });
    expect(await confirmApplicationContact(base, token, "123456")).toEqual({
      status: "WRONG_CODE",
      contact: null,
    });
  });
  it("resumes the existing application without a POST or new session", async () => {
    const fetcher = respond(summary);
    expect(await resumeApplication(base, token)).toEqual(summary);
    expect(fetcher).toHaveBeenCalledWith(
      `${base}/v1/gateq/apply/session`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
      }),
    );
  });
  it("validates ordered transcript and deterministic coverage responses", async () => {
    respond({
      turns: [
        { seq: 1, role: "Q", text: "What do you sell?", at: "2026-10-13" },
      ],
    });
    expect((await getApplicationTranscript(base, token)).turns[0]?.text).toBe(
      "What do you sell?",
    );
    const fetcher = respond({
      coverage: {
        version: 1,
        access: "NEEDS_INFORMATION",
        unmet: [],
        stillNeeded: ["Stage"],
        answered: [],
        unknown: [],
        declined: [],
        missing: [],
        contradictions: [],
      },
      contact: { required: true, confirmed: false },
      documentCount: 0,
      transcriptTurns: 1,
    });
    expect((await getApplicationCoverage(base, token)).contact.confirmed).toBe(
      false,
    );
    expect(fetcher).toHaveBeenCalledWith(
      `${base}/v1/gateq/apply/coverage`,
      expect.objectContaining({ method: "GET" }),
    );
    respond({ coverage: "untrusted" });
    await expect(getApplicationCoverage(base, token)).rejects.toThrow();
  });
});
