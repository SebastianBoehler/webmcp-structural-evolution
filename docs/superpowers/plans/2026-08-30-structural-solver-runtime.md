# Structural Solver Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared study/job runtime and deliver a bounded WebGPU linear-structural and topology adapter with independent Wasm verification.

**Architecture:** Studies live in `DesignDocument`; a solver registry dispatches immutable revision-keyed requests to cancellable adapters. Structural fields and topology candidates are artifact payloads whose metadata remains content-addressed in the existing artifact graph.

**Tech Stack:** TypeScript 7, Zod 4, Vitest 4, WebGPU/WGSL, Rust/Wasm, existing sparse topology solver.

**Spec:** `docs/superpowers/specs/2026-08-29-browser-native-cad-platform-design.md`

## Global Constraints

- Complete `2026-08-30-exact-cad-authoring.md` Task 1 before adding study references to the document.
- No saved result, synthetic field, or CPU optimizer may substitute when WebGPU is unavailable.
- Structural scope is small-strain, isotropic linear elasticity on bounded voxel domains only.
- A `verified` job requires residual, force balance, finite fields, capability envelope, and independent-reference evidence.
- Topology output is re-analyzed before it can be accepted or exported.
- Keep every new production file below 300 lines.

---

### Task 1: Shared study, solver, and capability contracts

**Files:**
- Create: `src/engineering/study-schema.ts`
- Create: `src/engineering/solver-adapter.ts`
- Create: `src/engineering/solver-registry.ts`
- Modify: `src/cad/document-schema.ts`
- Modify: `src/cad/command-schema.ts`
- Modify: `src/cad/transactions.ts`
- Modify: `src/cad/runtime-contracts.ts`
- Test: `src/engineering/study-schema.test.ts`
- Test: `src/engineering/solver-registry.test.ts`

**Interfaces:**
- Consumes: `DesignDocument`, `ArtifactRecord`, `EngineeringJobRequest`.
- Produces: `MaterialDefinition`, `NamedSelection`, `StructuralStudy`, `SolverCapability`, and `SolverAdapter<I, O>`.

- [ ] **Step 1: Write failing strict-schema tests**

```ts
it("rejects a structural study whose load selection is absent", async () => {
  await expect(defineDesignDocument({
    ...exactDocument,
    materials: [{ id: "al-6061", kind: "isotropic", densityKgM3: 2700, youngsModulusPa: 68.9e9, poissonRatio: 0.33, failureStressPa: 276e6 }],
    namedSelections: [],
    studies: [{ id: "link-load", kind: "structural-linear", bodyIds: ["link-body"], materialId: "al-6061", supports: ["fixed-end"], loads: [{ selectionId: "tip", forceN: [0, -500, 0] }] }],
  })).rejects.toThrow("Named selection is unresolved: tip");
});
```

- [ ] **Step 2: Run focused tests and confirm the contracts are absent**

Run: `pnpm vitest run src/engineering/study-schema.test.ts src/engineering/solver-registry.test.ts`
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement study schemas and document integrity**

Support `structural-linear`, `topology`, `mechanism`, and `thermal-steady` study kinds. Validate all body, material, selection, and source-study references; reject unsupported Poisson ratios outside `(-1, 0.5)` and non-positive physical properties. Add typed define/remove commands and exact changed-reference propagation.

- [ ] **Step 4: Implement adapter and registry interfaces**

```ts
export interface SolverAdapter<I, O> {
  readonly capability: SolverCapability;
  supports(request: EngineeringSolveRequest<I>): CapabilityDecision;
  run(request: EngineeringSolveRequest<I>, signal: AbortSignal, emit: (event: EngineeringJobEvent) => void): Promise<O>;
}

export interface SolverRegistry {
  register<I, O>(adapter: SolverAdapter<I, O>): void;
  resolve(kind: EngineeringJobKind, request: EngineeringSolveRequest<unknown>): SolverAdapter<unknown, unknown>;
}
```

Reject duplicate job kinds and return a structured `unsupported-capability` decision with the exceeded dimension, memory, precision, or material rule.
Define `EngineeringSolveRequest<I>` as the parsed base job request plus `studyId`,
`input`, and the exact source document. Add `EngineeringJobErrorSchema` with
`unsupported-capability`, `invalid-input`, `stale-revision`, `resource-limit`,
`device-lost`, `diverged`, and `internal-error`; require it on every failed event.

- [ ] **Step 5: Run domain tests and commit**

Run: `pnpm vitest run src/engineering src/cad && git diff --check`
Expected: PASS.

```bash
git add src/engineering/study-schema.ts src/engineering/study-schema.test.ts src/engineering/solver-adapter.ts src/engineering/solver-registry.ts src/engineering/solver-registry.test.ts src/cad/document-schema.ts src/cad/command-schema.ts src/cad/transactions.ts src/cad/runtime-contracts.ts
git commit -m "feat(engineering): define study and solver contracts"
```

### Task 2: Artifact payload store and cancellable job runner

**Files:**
- Create: `src/engineering/artifact-store.ts`
- Create: `src/engineering/job-runner.ts`
- Create: `src/engineering/job-ledger.ts`
- Test: `src/engineering/artifact-store.test.ts`
- Test: `src/engineering/job-runner.test.ts`

**Interfaces:**
- Consumes: `SolverRegistry`, `ArtifactRecord`, job schemas.
- Produces: `ArtifactStore.put/get/delete`, `EngineeringJobRunner.launch/cancel/subscribe`, immutable `JobLedgerEntry`.

- [ ] **Step 1: Write race and integrity tests**

Test content-digest mismatch, duplicate launch, cancellation-before-start, cancellation-during-run, late success after cancellation, adapter exception, and stale source revision. Require payload deletion when its metadata is invalidated.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run src/engineering/artifact-store.test.ts src/engineering/job-runner.test.ts`
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement in-memory alpha storage and runner**

```ts
export interface ArtifactStore {
  put(record: ArtifactRecord, payload: ArrayBuffer | Readonly<Record<string, ArrayBufferView>>): Promise<void>;
  get(id: string): Promise<ArtifactPayload | undefined>;
  delete(ids: readonly string[]): Promise<void>;
}
```

Hash payload bytes before `put`, keep ownership copies, never expose mutable backing buffers, and enforce one terminal event. The runner checks the current document revision immediately before dispatch and immediately before committing returned artifacts.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run src/engineering && pnpm build`
Expected: PASS.

```bash
git add src/engineering/artifact-store.ts src/engineering/artifact-store.test.ts src/engineering/job-runner.ts src/engineering/job-runner.test.ts src/engineering/job-ledger.ts
git commit -m "feat(engineering): run cancellable solver jobs"
```

### Task 3: WebGPU linear elasticity adapter

**Files:**
- Create: `src/solver/structural/structural-contract.ts`
- Create: `src/solver/structural/compile-structural-study.ts`
- Create: `src/solver/structural/webgpu-structural-adapter.ts`
- Create: `src/solver/structural/elasticity.wgsl`
- Create: `src/solver/structural/vector.wgsl`
- Create: `src/solver/structural/reduction.wgsl`
- Create: `src/solver/structural/pcg.ts`
- Modify: `crates/reference/src/topology/mod.rs`
- Modify: `crates/reference/src/topology/solver.rs`
- Modify: `src/reference/index.ts`
- Test: `src/solver/structural/compile-structural-study.test.ts`
- Test: `src/solver/structural/webgpu-structural-adapter.test.ts`
- Test: `crates/reference/src/topology/solver_tests.rs`

**Interfaces:**
- Consumes: exact body tessellation/SDF artifacts, `StructuralStudy`, WebGPU device capability.
- Produces: `StructuralResult` with displacement/stress fields, compliance, residual, force balance, strain energy, and verifier deltas.

- [ ] **Step 1: Add analytical fixture tests**

Use an axial bar and a cantilever beam. Require axial displacement within `2%` of `FL/(EA)`, cantilever tip displacement within `5%` of `FL^3/(3EI)`, relative residual at or below `1e-5`, and force-balance error below `1e-4` of applied load.

- [ ] **Step 2: Run tests and confirm the WebGPU operator is absent**

Run: `pnpm vitest run src/solver/structural && cargo test --manifest-path crates/reference/Cargo.toml topology`
Expected: FAIL because the structural adapter and reference fixture exports do not exist.

- [ ] **Step 3: Compile named selections into a bounded voxel system**

Reject empty supports, empty loads, disconnected loaded islands, grid dimensions over the adapter capability, nonuniform cells, unsupported materials, or selections that rasterize to zero cells. Record rasterization tolerance and selected-cell hashes.

- [ ] **Step 4: Implement matrix-free elasticity and PCG**

Run stiffness application, dot products, reductions, and vector updates on WebGPU buffers. Check `signal.aborted` between dispatch groups; use residual-based convergence, a fixed iteration ceiling, and explicit device-loss handling. Compute von Mises stress from the converged displacement field.

- [ ] **Step 5: Add independent Rust/Wasm fixture evaluation**

Expose the same axial-bar and cantilever fixtures from Rust without reusing WGSL results. `verified` requires the analytical gates plus WebGPU/Wasm field agreement at locked common resolutions.

- [ ] **Step 6: Run structural gates and commit**

Run: `pnpm wasm:build && pnpm vitest run src/solver/structural && cargo test --manifest-path crates/reference/Cargo.toml && pnpm build`
Expected: PASS in automated fixtures; GPU browser execution remains pending Task 5.

```bash
git add src/solver/structural crates/reference/src/topology/mod.rs crates/reference/src/topology/solver.rs crates/reference/src/topology/solver_tests.rs src/reference/index.ts
git commit -m "feat(fea): add verified WebGPU elasticity"
```

### Task 4: General topology adapter and post-extraction re-analysis

**Files:**
- Create: `src/solver/topology/topology-adapter.ts`
- Create: `src/solver/topology/density-filter.wgsl`
- Create: `src/solver/topology/sensitivity.wgsl`
- Create: `src/solver/topology/extract-topology.ts`
- Create: `src/solver/topology/topology-acceptance.ts`
- Modify: `src/optimization/topology-probe.ts`
- Modify: `src/manufacturing/topology-stl.ts`
- Test: `src/solver/topology/topology-adapter.test.ts`
- Test: `src/solver/topology/topology-acceptance.test.ts`

**Interfaces:**
- Consumes: a verified structural study/result and topology objective/constraints.
- Produces: density iterations, candidate manufacturing mesh, post-extraction structural result, and explicit acceptance decision.

- [ ] **Step 1: Write failing generality and acceptance tests**

Run the same adapter on the reference drone and cobot link inputs. Reject fixture IDs in solver branches, missing minimum-feature constraints, non-monotonic objective history, disconnected required interfaces, non-watertight extraction, and a candidate whose re-analysis violates displacement, stress, safety-factor, or material-fraction constraints.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run src/solver/topology`
Expected: FAIL with missing adapter modules.

- [ ] **Step 3: Move filtering and sensitivity updates to WebGPU**

Use the structural adapter for each analysis iteration. Keep density in `[0,1]`, enforce move limits and volume fraction, emit partial objective history, and cancel between iterations. Preserve `runTopologyProbe` as a compatibility wrapper that constructs a real study; remove its claim of `verified` when only the Wasm path ran.

- [ ] **Step 4: Extract, validate, and re-analyze**

Generate the manufacturing mesh at an explicit iso-value and tolerance; validate closure, orientation, required-interface contact, protected voids, and minimum features. Rasterize the extracted geometry and rerun the structural adapter before acceptance.

- [ ] **Step 5: Run focused and regression tests, then commit**

Run: `pnpm vitest run src/solver/topology src/optimization src/manufacturing && pnpm build`
Expected: PASS.

```bash
git add src/solver/topology src/optimization/topology-probe.ts src/manufacturing/topology-stl.ts
git commit -m "feat(topology): optimize and reverify general parts"
```

### Task 5: Live structural and topology browser gate

**Files:**
- Create: `src/solver/structural/browser-structural-gate.ts`
- Create: `docs/testing/structural-topology-browser-gate.md`
- Test: `src/solver/structural/browser-structural-gate.test.ts`

**Interfaces:**
- Consumes: solver registry, job runner, drone/cobot benchmark documents.
- Produces: a serializable gate report with capability limits, timings, convergence, analytical/Wasm deltas, topology history, extraction checks, re-analysis, cancellation, and device identity.

- [ ] **Step 1: Add gate report completeness tests**

Require both geometries, actual `GPUAdapterInfo`, all numerical thresholds, cancellation proof, and post-extraction re-analysis. Reject a report with only automated fixture results.

- [ ] **Step 2: Implement and run automated checks**

Run: `pnpm check && git diff --check`
Expected: all tests, build, Wasm build, and Rust tests pass.

- [ ] **Step 3: Run the live browser gate**

Run: `pnpm dev --host 127.0.0.1`
In a WebGPU-capable browser, run axial bar, cantilever, drone topology, cobot topology, cancellation, and post-extraction re-analysis. Record exact device limits, grid sizes, iteration counts, residuals, errors, timings, and console status in `docs/testing/structural-topology-browser-gate.md`.

- [ ] **Step 4: Commit measured proof**

```bash
git add src/solver/structural/browser-structural-gate.ts src/solver/structural/browser-structural-gate.test.ts docs/testing/structural-topology-browser-gate.md
git commit -m "test(fea): record live structural topology gate"
```
