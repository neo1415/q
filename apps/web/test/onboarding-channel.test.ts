import { describe, expect, it } from "vitest";

import type { RuntimePort } from "../src/features/founder-onboarding/adapters/runtime-port";
import { createFixtureRuntimePort } from "../src/features/founder-onboarding/adapters/fixture-port";
import { createRuntimeFounderClient } from "../src/features/founder-onboarding/adapters/runtime-port";

/**
 * Lane ob1's response channel: the form says its saves came from the form,
 * a tapped option in the conversation says it came from the conversation,
 * so coverage can tell a person where each answer was given.
 */
const SOURCE = { adapter: "fixture", synthetic: true } as const;

function recording() {
  const port = createFixtureRuntimePort({ storage: null, seed: "reset" });
  const channels: (string | undefined)[] = [];
  const spied: RuntimePort = {
    ...port,
    submit: (input) => {
      channels.push(input.channel);
      return port.submit(input);
    },
  };
  return { client: createRuntimeFounderClient(spied, SOURCE), channels };
}

describe("response channel", () => {
  it("tags a form save FORM", async () => {
    const { client, channels } = recording();
    await client.getSession();
    await client.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "raising_now" },
    });
    expect(channels).toEqual(["FORM"]);
  });

  it("tags a tapped option in the conversation CONVERSATION", async () => {
    const { client, channels } = recording();
    await client.getSession();
    const submitValue = client.submitValue;
    if (submitValue === undefined) throw new Error("no submitValue");
    await submitValue({
      stepKey: "F0.intent",
      value: { type: "SINGLE_SELECT", optionKey: "raising_now" },
    });
    expect(channels).toEqual(["CONVERSATION"]);
  });
});
