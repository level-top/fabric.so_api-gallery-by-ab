"use client";

import * as React from "react";

type Props = {
  /**
   * Optional key to re-run when navigating between resources without a full reload.
   */
  depsKey?: string;
};

export function ScrollToTopOnMount({ depsKey }: Props) {
  React.useEffect(() => {
    // Force detail pages to start at the top. Some browsers / router states can
    // preserve scroll position across navigations in App Router.
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [depsKey]);

  return null;
}
