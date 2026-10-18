// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChartBody } from "../src/features/q/blocks/data-blocks";
import { chartLabels } from "../src/features/q/blocks/data-block-logic";

afterEach(cleanup);

it("refuses repeated categories and contradictory supplied orders", () => {
  const points = (...labels: string[]) => ({
    points: labels.map((label) => ({ label })),
  });
  expect(chartLabels([points("Jul", "Jul")])).toBeNull();
  expect(chartLabels([points("Jul", "Aug"), points("Aug", "Jul")])).toBeNull();
  expect(chartLabels([points("Jul", "Sep"), points("Aug", "Sep")])).toEqual([
    "Jul",
    "Aug",
    "Sep",
  ]);
});

it("aligns evidence by category and leaves missing periods unknown", () => {
  const { container } = render(
    <ChartBody
      block={{
        kind: "CHART",
        chart: "LINE",
        title: "Revenue",
        unit: "month",
        currency: null,
        series: [
          {
            label: "A",
            truthClass: "VERIFIED",
            evidenceStatus: "PLATFORM_VERIFIED",
            source: "Ledger",
            points: [
              { label: "Jul", value: 10 },
              { label: "Sep", value: 30 },
            ],
          },
          {
            label: "B",
            truthClass: "VERIFIED",
            evidenceStatus: "PLATFORM_VERIFIED",
            source: "Ledger",
            points: [
              { label: "Aug", value: 20 },
              { label: "Sep", value: 40 },
            ],
          },
        ],
      }}
    />,
  );
  const rows = [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.children].map((cell) => cell.textContent),
  );
  expect(rows).toEqual([
    ["Jul", "10", "Not known"],
    ["Aug", "Not known", "20"],
    ["Sep", "30", "40"],
  ]);
  // A missing period must break the line rather than imply interpolation.
  const path = container.querySelector("path")?.getAttribute("d") ?? "";
  expect(path.match(/M/gu)).toHaveLength(2);
  expect(container.querySelectorAll("circle")).toHaveLength(4);
});
