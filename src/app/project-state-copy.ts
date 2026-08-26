import type { FoundationProjectState, SemanticSelection } from "../webmcp/schemas";

function freezeValue<T>(value: T): T {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || value instanceof Float32Array) return value;
  for (const child of Object.values(value)) freezeValue(child);
  return Object.freeze(value);
}

const mutatingMethods = new Set(["copyWithin", "fill", "reverse", "set", "sort"]);

function readonlyField(field: Float32Array): Float32Array {
  return new Proxy(field, {
    get(target, property) {
      if (property === "buffer") return target.slice().buffer;
      if (property === "subarray") return (start?: number, end?: number) => target.slice(start, end);
      if (property === "valueOf") return () => new Float32Array(target);
      if (typeof property === "string" && mutatingMethods.has(property)) {
        return () => { throw new TypeError("Verified field output is read-only"); };
      }
      const value = Reflect.get(target, property, target);
      if (property === "constructor") return value;
      return typeof value === "function" ? value.bind(target.slice()) : value;
    },
    set() { return true; },
    defineProperty() { return false; },
    deleteProperty() { return false; },
  });
}

export function createInitialProjectState(options: {
  readonly contextRevision: string;
  readonly acceptedBranchRevision: string;
  readonly selection: SemanticSelection;
  readonly locks: readonly string[];
  readonly capability: FoundationProjectState["capability"];
}): FoundationProjectState {
  return freezeValue({
    contextRevision: options.contextRevision,
    acceptedBranchRevision: options.acceptedBranchRevision,
    selection: { ...options.selection },
    locks: [...options.locks],
    stagedBranches: [],
    capability: options.capability,
    operationStatus: "idle",
    receipts: [],
  });
}

export function publishProjectState(
  next: FoundationProjectState,
  verifiedOutputs: Map<string, Float32Array>,
): FoundationProjectState {
  const stagedBranches = next.stagedBranches.map((branch) => {
    if (branch.result?.status !== "verified") return branch;
    let authoritative = verifiedOutputs.get(branch.branchRevision);
    if (!authoritative) {
      authoritative = new Float32Array(branch.result.output);
      verifiedOutputs.set(branch.branchRevision, authoritative);
    }
    const { output: _exposedCopy, ...metrics } = branch.result;
    return {
      ...branch,
      result: { ...metrics, output: readonlyField(authoritative) },
    };
  });
  return freezeValue({ ...next, stagedBranches });
}

export { freezeValue };
