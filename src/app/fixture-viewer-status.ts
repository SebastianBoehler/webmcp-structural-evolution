export function fixtureViewerStatus(input: Readonly<{
  hasTopology: boolean;
  layoutState: "verified" | "dragging" | "changed" | "validating";
  pendingPromotion: boolean;
  pendingEstimate: boolean;
  supportsFlightReplay: boolean;
}>): string | undefined {
  if (!input.hasTopology) return input.pendingPromotion ? "Verified branch ready for human review" : undefined;
  if (input.pendingEstimate) return "Interactive estimate preview · unverified and unaccepted";
  if (input.layoutState === "dragging") {
    const geometry = input.supportsFlightReplay ? "rotor safety geometry" : "design constraints";
    return `Moving component · ${geometry} follow`;
  }
  if (input.layoutState === "changed") return "Layout changed · previous topology evidence is stale";
  if (input.layoutState === "validating") return "Validating current layout before topology may resume";
  return input.pendingPromotion ? "Candidate topology · verified and awaiting human acceptance" : undefined;
}
