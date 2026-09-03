/** Owner and logical producer for every Investor bounded-context event. */
export const INVESTOR_EVENT_OWNER = "@capital-q/investors" as const;
export const INVESTOR_EVENT_PRODUCER = "capitalq://api/core/investor" as const;
