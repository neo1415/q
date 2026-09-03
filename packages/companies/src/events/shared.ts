/** Owner and logical producer for every Company bounded-context event. */
export const COMPANY_EVENT_OWNER = "@capital-q/companies" as const;
export const COMPANY_EVENT_PRODUCER = "capitalq://api/core/company" as const;
