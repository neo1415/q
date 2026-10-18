import { describe, expect, it } from "vitest";

import type { NotificationDto } from "@capital-q/contracts";

import { summarisesCards } from "../src/features/work/notice-groups";

/**
 * Recovery D-13: an instruction's "N things need your yes" notice only
 * summarises the cards Needs you lists one by one, so it is not counted
 * (or listed) as one more thing waiting.
 */

const notice = (title: string) => ({ title }) as unknown as NotificationDto;

describe("the Needs you count (D-13)", () => {
  it("recognises the instruction's card summary in either number", () => {
    expect(
      summarisesCards(
        notice('1 thing needs your yes for "Reply to investors"'),
      ),
    ).toBe(true);
    expect(
      summarisesCards(
        notice('3 things need your yes for "Reply to investors"'),
      ),
    ).toBe(true);
  });

  it("keeps every other notice that waits on them", () => {
    expect(summarisesCards(notice("Zino is waiting for your yes"))).toBe(false);
    expect(summarisesCards(notice("Your approval for Zino lapsed"))).toBe(
      false,
    );
    expect(summarisesCards(notice("Zino is waiting for a reply"))).toBe(false);
  });
});
