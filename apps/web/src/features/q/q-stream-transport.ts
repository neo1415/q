/**
 * Q room W7: Q's live run stream, loaded when the first run is followed
 * rather than with the page. The stream checks every event against the
 * contracts (Zod), so importing it eagerly brought Zod into the first-load
 * script; imported by name here, the bundler keeps only what it uses.
 */
export { streamQRunEvents } from "@capital-q/api-client";
export { isTerminalQStreamEvent } from "@capital-q/contracts";
