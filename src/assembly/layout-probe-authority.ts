import type { LayoutAuthority } from "./layout-validation";

export function topologyLayoutIsVerified(layout: LayoutAuthority | undefined): boolean {
  return layout === undefined || layout.state === "verified";
}

export function topologyLayoutRejection(layout: LayoutAuthority | undefined): string | undefined {
  return topologyLayoutIsVerified(layout)
    ? undefined
    : `Layout version ${layout!.version} must be validated for the exact current assembly before topology can run.`;
}
