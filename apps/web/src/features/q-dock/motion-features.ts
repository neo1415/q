import { animate, domMax } from "motion/react";

/**
 * Motion's drag features and its spring, loaded after the dock has painted
 * (about 35 KB gzip that no page waits for). The dock renders, opens and
 * moves by menu before this arrives; only the drag and the flown settle
 * wait for it.
 */
export default domMax;
export { animate };
