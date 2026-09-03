import type { ComponentProps } from "react";
import { WorkbenchReviewDock } from "./WorkbenchReviewDock";

type DockProps = ComponentProps<typeof WorkbenchReviewDock>;

export function FoundationJourneyReviewDock({ hidden, ...props }: DockProps & { readonly hidden: boolean }) {
  return <aside className="review-dock" aria-label="Review evidence" hidden={hidden}>
    <WorkbenchReviewDock {...props} />
  </aside>;
}
