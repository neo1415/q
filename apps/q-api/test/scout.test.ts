import { describe, expect, it } from "vitest";

import {
  readsAsEnglish,
  scoutQuery,
  scoutRelevance,
  type ScoutEntity,
} from "../src/composition/scout.js";
import { composeReturningOpener } from "../src/voice/returning-opener.js";

/** Q's scout (founder direction 2026-09-29): the query and the opener. */
describe("the scout", () => {
  it("searches for the company's own name, pinned by its own site", () => {
    expect(
      scoutQuery("Zino Aviation", "https://www.zinoaviation.com/about"),
    ).toBe('"Zino Aviation" OR zinoaviation.com news');
    expect(scoutQuery(" Yamfield Agro ", null)).toBe('"Yamfield Agro" news');
    expect(scoutQuery("Kazikit", "not a url")).toBe('"Kazikit" news');
  });

  it("opens with what it found when there is no call or notes first", () => {
    expect(
      composeReturningOpener(
        "Zino",
        {
          nextCall: null,
          remindersDue: 0,
          firstReminder: null,
          notesReady: 0,
          unreadNotices: 1,
          scoutFinding: "Zino Aviation opens a Lagos hangar",
        },
        new Date("2026-09-30T08:00:00Z"),
      ),
    ).toBe(
      'Hi Zino. I spotted something new about your company: "Zino Aviation opens a Lagos hangar". Want the gist?',
    );
  });
});

/**
 * QA demo pass: "Q found something new about Ajopot" for a page in
 * Albanian and a page about dogs. A page is surfaced only when it is about
 * THIS company -- named, and tied to it by its site, its place or what it
 * does -- in a language they read.
 */
describe("what the scout surfaces", () => {
  const AJOPOT: ScoutEntity = {
    name: "Ajopot",
    websiteUrl: "https://ajopot.example",
    description:
      "Ajopot digitises ajo, the rotating savings circle, with members' funds held at a licensed partner bank.",
    city: "Lagos",
    country: "NG",
  };

  it("drops a page in Albanian, even when it names them", () => {
    const albanian = {
      url: "https://lajme.example.al/ajopot",
      title: "Ajopot dhe kursimet e grupit në qytet",
      snippet:
        "Një grup miqsh në Tiranë filloi një mënyrë të re për të kursyer para së bashku çdo muaj, të quajtur Ajopot.",
    };
    expect(readsAsEnglish(`${albanian.title} ${albanian.snippet}`)).toBe(false);
    expect(scoutRelevance(albanian, AJOPOT)).toMatchObject({ surfaced: false });
  });

  it("drops a page about dogs that only shares the name", () => {
    const dogs = {
      url: "https://pets.example.com/ajopot-dog-bowl",
      title: "Ajopot: the slow-feeder bowl your dog will love",
      snippet:
        "The Ajopot bowl helps dogs eat more slowly and is easy to clean. Our review of the best dog bowls for puppies and older dogs this year.",
    };
    expect(scoutRelevance(dogs, AJOPOT)).toEqual({
      surfaced: false,
      why: "the name alone",
    });
  });

  it("surfaces a genuine story about them, tied by place and by what they do", () => {
    const genuine = {
      url: "https://techcabal.example/2026/10/ajopot-savings",
      title: "Ajopot brings the ajo savings circle online in Lagos",
      snippet:
        "The Nigerian startup says members' funds sit at a licensed partner bank and that its savings circle product is growing fast.",
    };
    expect(scoutRelevance(genuine, AJOPOT)).toMatchObject({ surfaced: true });
  });

  it("surfaces a page on their own site; a page with too few words to read is not surfaced", () => {
    expect(
      scoutRelevance(
        {
          url: "https://blog.ajopot.example/launch",
          title: "We are launching in Abuja",
          snippet:
            "This month we open our first circles in Abuja with partners in the city.",
        },
        AJOPOT,
      ).surfaced,
    ).toBe(true);
    expect(
      scoutRelevance(
        { url: "https://x.example/a", title: "Ajopot", snippet: "" },
        AJOPOT,
      ).surfaced,
    ).toBe(false);
  });
});
