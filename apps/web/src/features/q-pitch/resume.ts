/**
 * Persistent mode (owner 15 Oct): the running tour and its chapter, per tab,
 * so a reload or a typed address picks the tour up where it was. A viewer
 * convenience only (sessionStorage); the host still re-checks the account
 * and asks the person to start.
 */
export const RESUME_KEY = "cq.qpitch.resume";
