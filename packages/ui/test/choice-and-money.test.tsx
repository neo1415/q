// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ChoiceList, MultiChoiceList } from "../src/components/choice-list.js";
import {
  formatAmountForDisplay,
  MoneyInput,
  sanitiseAmount,
  type MoneyValue,
} from "../src/components/money-input.js";

const OPTIONS = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
  { value: "none", label: "Nothing yet" },
];

describe("ChoiceList", () => {
  it("is a real radio group with a legend", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<string | undefined>(undefined);
      return (
        <ChoiceList
          id="c"
          name="c"
          legend="Pick one"
          options={OPTIONS}
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Pick one" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: "Option B" }));
    expect(screen.getByRole("radio", { name: "Option B" })).toHaveProperty(
      "checked",
      true,
    );
    expect(screen.getByRole("radio", { name: "Option A" })).toHaveProperty(
      "checked",
      false,
    );
  });

  it("MultiChoiceList uses checkboxes and honours exclusive options", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [values, setValues] = useState<readonly string[]>([]);
      return (
        <MultiChoiceList
          id="m"
          name="m"
          legend="Pick any"
          options={OPTIONS}
          values={values}
          onChange={setValues}
          exclusiveValues={["none"]}
        />
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Option A" }));
    await user.click(screen.getByRole("checkbox", { name: "Option B" }));
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    await user.click(screen.getByRole("checkbox", { name: "Nothing yet" }));
    expect(
      screen
        .getAllByRole("checkbox", { checked: true })
        .map((el) => el.getAttribute("value")),
    ).toEqual(["none"]);
    await user.click(screen.getByRole("checkbox", { name: "Option A" }));
    expect(
      screen
        .getAllByRole("checkbox", { checked: true })
        .map((el) => el.getAttribute("value")),
    ).toEqual(["a"]);
  });
});

describe("MoneyInput", () => {
  it("keeps the amount as an exact string and formats only for display", async () => {
    const user = userEvent.setup();
    const seen: MoneyValue[] = [];
    function Harness() {
      const [value, setValue] = useState<MoneyValue>({
        amount: "",
        currency: "USD",
      });
      return (
        <MoneyInput
          id="raise"
          label="Target amount"
          value={value}
          currencies={[
            { code: "USD", label: "US dollar" },
            { code: "EUR", label: "Euro" },
          ]}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Target amount",
    });
    await user.type(input, "500000");
    expect(seen.at(-1)).toEqual({ amount: "500000", currency: "USD" });
    expect(typeof seen.at(-1)?.amount).toBe("string");
    expect(input.value).toBe("500,000");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Currency" }),
      "EUR",
    );
    expect(seen.at(-1)).toEqual({ amount: "500000", currency: "EUR" });
  });

  it("sanitises input without arithmetic", () => {
    expect(sanitiseAmount("1,250,000.507")).toBe("1250000.50");
    expect(sanitiseAmount("007")).toBe("7");
    expect(sanitiseAmount("abc")).toBe("");
    expect(formatAmountForDisplay("12345678.9")).toBe("12,345,678.9");
    expect(formatAmountForDisplay("")).toBe("");
  });
});
