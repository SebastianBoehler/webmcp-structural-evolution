export function fixtureViewerStatus(input: Readonly<{
  hasTopology: boolean;
  layoutState: "verified" | "dragging" | "changed";
  pendingPromotion: boolean;
  supportsFlightReplay: boolean;
}>): string | undefined {
  if (!input.hasTopology) return input.pendingPromotion ? "Verified branch ready for human review" : undefined;
  if (input.layoutState === "dragging") {
    const geometry = input.supportsFlightReplay ? "rotor safety geometry" : "design constraints";
    return `Moving component · ${geometry} follow`;
  }
  if (input.layoutState === "changed") return "Layout changed · previous topology evidence is stale";
  return input.pendingPromotion ? "Candidate topology · verified and awaiting human acceptance" : undefined;
}
