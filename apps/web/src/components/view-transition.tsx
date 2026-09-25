/// <reference types="react/canary" />
import * as React from "react";
import type { ReactNode } from "react";

/**
 * React's `<ViewTransition>` where it exists, and nothing where it does not.
 *
 * The App Router renders with React canary, which has it; the unit-test
 * runner renders with stable React, which does not. A missing transition
 * is only a missing animation, never a missing element, so outside the
 * App Router this renders its children unchanged.
 */

type Props = React.ViewTransitionProps;

function Passthrough({ children }: { readonly children?: ReactNode }) {
  return <>{children}</>;
}

const Native: unknown = Reflect.get(React, "ViewTransition");

// Like Fragment, the canary export is a symbol React recognises, not a
// function; its presence is the whole test.
export const ViewTransition = (
  Native === undefined ? Passthrough : Native
) as React.ComponentType<Props>;
