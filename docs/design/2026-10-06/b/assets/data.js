// Fictional demo content for the mockups. No real companies or people.
export const PERSON = { name: "Amara Okafor", org: "Harbour Lane Capital", mandate: "Seed to Series A, climate and fintech, UK and Nordics, £250k to £1.5m" };

const P = (stage, sector, geo, cheque, traction, team) => [
  ["Stage", ...stage], ["Sector", ...sector], ["Geography", ...geo], ["Cheque", ...cheque], ["Traction", ...traction], ["Team", ...team],
];

export const COMPANIES = [
  { id: "norrland", name: "Norrland Grid", line: "Schedules grid batteries to sell power at the best hour", place: "Stockholm", stage: "Seed", score: 8.6, hue: 1,
    why: ["Seed round inside your cheque range", "Grid software is core to your mandate", "£38k a month in revenue, backed by statements"],
    params: P(["Strong", "Seed"], ["Strong", "Grid software"], ["Good", "Sweden"], ["Strong", "£400k open"], ["Good", "£38k a month"], ["Unknown", "Not shared yet"]) },
  { id: "kestrel", name: "Kestrel Heat", line: "Heat pumps for terraced homes, installed in a day", place: "Leeds", stage: "Seed", score: 8.1, hue: 2,
    why: ["Climate hardware with recurring service income", "Two founders who built an installer before", "Raising £900k, lead not yet set"],
    params: P(["Strong", "Seed"], ["Good", "Home energy"], ["Strong", "UK"], ["Strong", "£900k round"], ["Good", "310 installs"], ["Strong", "Second company"]) },
  { id: "atlas", name: "Atlas Ledger", line: "Treasury software for small lenders", place: "London", stage: "Series A", score: 7.4, hue: 3,
    why: ["Fintech with paying lenders", "Round is at the top of your range", "Revenue is a claim: no documents yet"],
    params: P(["Good", "Series A"], ["Strong", "Fintech"], ["Strong", "UK"], ["Partial", "£1.5m minimum"], ["Unknown", "Claimed, no documents"], ["Good", "Ex-bank team"]) },
  { id: "tidewater", name: "Tidewater Labs", line: "Sensors that find leaks in water mains", place: "Bergen", stage: "Seed", score: 7.1, hue: 4,
    why: ["Climate adjacent, utility buyers", "Pilots with two councils", "Long sales cycles"],
    params: P(["Strong", "Seed"], ["Partial", "Water"], ["Good", "Norway"], ["Good", "£600k open"], ["Partial", "2 pilots"], ["Good", "Engineers"]) },
  { id: "morrow", name: "Morrow Pay", line: "Pay-by-bank checkout for marketplaces", place: "Manchester", stage: "Seed", score: 6.9, hue: 5,
    why: ["Fintech, early revenue", "Crowded field", "Strong founder-market fit"],
    params: P(["Strong", "Seed"], ["Good", "Payments"], ["Strong", "UK"], ["Strong", "£500k open"], ["Partial", "£9k a month"], ["Good", "Ex-Adyen"]) },
  { id: "lumen", name: "Lumen Carbon", line: "Measures carbon in farm soil from satellite data", place: "Aarhus", stage: "Pre-seed", score: 6.4, hue: 6,
    why: ["Climate, very early", "Below your usual stage", "Science team with a patent"],
    params: P(["Partial", "Pre-seed"], ["Strong", "Carbon"], ["Good", "Denmark"], ["Good", "£300k open"], ["Unknown", "Pre-revenue"], ["Strong", "PhD founders"]) },
  { id: "ferrous", name: "Ferrous Works", line: "Recycles steel offcuts into new stock", place: "Sheffield", stage: "Series A", score: 6.2, hue: 7,
    why: ["Industrial climate play", "Capital heavy", "Real revenue"],
    params: P(["Good", "Series A"], ["Good", "Materials"], ["Strong", "UK"], ["Partial", "£3m round"], ["Strong", "£1.1m a year"], ["Good", "Operators"]) },
  { id: "quarry", name: "Quarry Health", line: "Claims checks for private clinics", place: "Glasgow", stage: "Seed", score: 5.8, hue: 1,
    why: ["Outside your sectors", "Good traction", "Fits on cheque"],
    params: P(["Strong", "Seed"], ["Partial", "Health admin"], ["Strong", "UK"], ["Strong", "£700k open"], ["Good", "£20k a month"], ["Unknown", "Not shared yet"]) },
  { id: "sable", name: "Sable Freight", line: "Shared electric vans for city deliveries", place: "Oslo", stage: "Seed", score: 5.5, hue: 2,
    why: ["Climate logistics", "Unit costs unproven", "Fits on stage"],
    params: P(["Strong", "Seed"], ["Good", "Logistics"], ["Good", "Norway"], ["Good", "£800k open"], ["Partial", "1 city"], ["Good", "Ex-Bring"]) },
  { id: "halcyon", name: "Halcyon Cooling", line: "Low-power cooling for small data rooms", place: "Dublin", stage: "Seed", score: 5.2, hue: 3,
    why: ["Energy efficiency", "Ireland is outside your regions", "Early pilots"],
    params: P(["Strong", "Seed"], ["Good", "Efficiency"], ["Partial", "Ireland"], ["Good", "£600k open"], ["Partial", "3 pilots"], ["Good", "Engineers"]) },
];

export const RESEARCH = [
  { id: "yc-what", name: "What Y Combinator is", line: "An accelerator that invests in very early companies, several batches a year", score: null, hue: 1,
    why: ["A standard deal: a fixed cheque for a small stake", "Batches of a few hundred companies", "Demo Day is where most rounds start"], sources: 4 },
  { id: "yc-you", name: "What it means for you", line: "Where its companies meet your mandate", score: null, hue: 3,
    why: ["Climate and fintech are a growing share of each batch", "Most raise a seed round within weeks of Demo Day", "UK and Nordic founders are a small minority"], sources: 3 },
  { id: "yc-ask", name: "Questions to ask", line: "What Q could not confirm", score: null, hue: 4,
    why: ["Current valuation caps at Demo Day: not public", "How many climate companies in the current batch", "Whether European companies relocate"], sources: 2 },
];

export const LEVEL_WORD = { Strong: "Strong", Good: "Good", Partial: "Partial", Unknown: "Unknown" };
