import type { TopologyResult } from "../solver/topology/topology-contract";

export function serializeAcceptedTopologyStl(candidate: TopologyResult): DataView {
  void candidate;
  throw new Error("Topology manufacturing export requires Task 5 promotion and a promoted accepted candidate");
}

export function downloadTopologyStl(
  candidate: TopologyResult,
  filename = "topology-optimized-drone-frame.stl",
): void {
  const output = serializeAcceptedTopologyStl(candidate);
  const bytes = new Uint8Array(output.byteLength);
  bytes.set(new Uint8Array(output.buffer, output.byteOffset, output.byteLength));
  const url = URL.createObjectURL(new Blob([bytes], { type: "model/stl" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
