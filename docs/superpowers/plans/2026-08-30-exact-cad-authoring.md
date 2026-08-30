# Exact CAD Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an exact, revisioned sketch-and-feature CAD path backed by OCCT Wasm, with semantic tessellation and STEP round trips.

**Architecture:** Extend `DesignDocument` with exact modeling intent, keep OCCT handles inside a dedicated worker, and expose only typed evaluation events and revision-keyed artifacts. Replace no existing display path until the exact path passes its own browser gate.

**Tech Stack:** TypeScript 7, Zod 4, Vitest 4, Vite 8 workers, `occt-wasm@4.3.2`, OCCT Wasm, Three.js semantic meshes.

**Spec:** `docs/superpowers/specs/2026-08-29-browser-native-cad-platform-design.md`

## Global Constraints

- Pin `occt-wasm` to exactly `4.3.2`; do not add a second CAD kernel.
- OCCT owns exact solids; `three-bvh-csg` remains display-only legacy code and never satisfies an exact-CAD result.
- Store SI values in the document and preserve explicit display units at UI boundaries.
- Keep OCCT objects and handles inside the CAD worker; messages contain schemas, typed arrays, or byte arrays only.
- A failed feature, invalid solid, or ambiguous semantic reference fails the whole rebuild with a typed error.
- Keep every new production file below 300 lines.

---

### Task 1: Exact modeling document schemas

**Files:**
- Create: `src/cad/model-schema.ts`
- Modify: `src/cad/document-schema.ts`
- Modify: `src/cad/command-schema.ts`
- Modify: `src/cad/transactions.ts`
- Modify: `src/cad/index.ts`
- Test: `src/cad/model-schema.test.ts`
- Test: `src/cad/transactions.test.ts`

**Interfaces:**
- Consumes: `EntityIdSchema`, physical unit schemas, `DesignTransactionSchema`.
- Produces: `SketchSchema`, `FeatureSchema`, `BodySchema`, `ComponentSchema`, `AssemblyInstanceSchema`, `MateSchema`, `NamedSelectionSchema`; transaction commands for each mutable collection.

- [ ] **Step 1: Write failing schema tests**

```ts
it("accepts a constrained profile and ordered exact features", async () => {
  const document = await defineDesignDocument({
    ...baseContent,
    sketches: [{ id: "base-sketch", plane: "frame:world", entities: [
      { id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.08, 0.04] },
    ], constraints: [{ id: "width", kind: "horizontal-length", entityId: "outline", valueM: 0.08 }] }],
    features: [
      { id: "base", kind: "extrude", sketchId: "base-sketch", distanceM: 0.01 },
      { id: "boss", kind: "revolve", sketchId: "boss-sketch", angleRad: Math.PI * 2 },
    ],
    bodies: [{ id: "link-body", featureId: "boss" }], components: [], instances: [], mates: [], namedSelections: [],
  });
  expect(document.features.map(({ id }) => id)).toEqual(["base", "boss"]);
});
```

- [ ] **Step 2: Run the focused test and confirm the current strict document schema rejects the new fields**

Run: `pnpm vitest run src/cad/model-schema.test.ts src/cad/transactions.test.ts`
Expected: FAIL because exact modeling schemas and commands do not exist.

- [ ] **Step 3: Implement strict schemas and integrity checks**

Define only the alpha feature set: line, arc, circle, rectangle; coincident, horizontal, vertical, distance, radius, and angle constraints; extrude, revolve, union, cut, and intersect features. Reject duplicate IDs, forward/cyclic feature references, open profiles used by solid features, unresolved references, non-positive distances, and non-finite values.

```ts
export const FeatureSchema = z.discriminatedUnion("kind", [
  z.object({ id: EntityIdSchema, kind: z.literal("extrude"), sketchId: EntityIdSchema, distanceM: positive }).strict(),
  z.object({ id: EntityIdSchema, kind: z.literal("revolve"), sketchId: EntityIdSchema, angleRad: positive.max(Math.PI * 2) }).strict(),
  z.object({ id: EntityIdSchema, kind: z.enum(["union", "cut", "intersect"]), leftFeatureId: EntityIdSchema, rightFeatureId: EntityIdSchema }).strict(),
]);
```

Add collection-level commands such as `define-sketch`, `define-feature`, `remove-feature`, `define-component`, `place-instance`, `define-mate`, and `define-named-selection`. Each command returns exact changed references (`sketch:<id>`, `feature:<id>`, `body:<id>`, and dependent consumers) for artifact invalidation.
Extend `SemanticReferenceSchema` with those prefixes before the commands are added.

- [ ] **Step 4: Run CAD domain tests**

Run: `pnpm vitest run src/cad/model-schema.test.ts src/cad/document-schema.test.ts src/cad/transactions.test.ts src/cad/artifact-invalidation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the document model**

```bash
git add src/cad/model-schema.ts src/cad/model-schema.test.ts src/cad/document-schema.ts src/cad/command-schema.ts src/cad/transactions.ts src/cad/transactions.test.ts src/cad/index.ts
git commit -m "feat(cad): model exact sketches and features"
```

### Task 2: OCCT worker bridge and lifecycle

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vite.config.ts`
- Create: `src/cad/kernel/occt-bridge.ts`
- Create: `src/cad/kernel/occt-worker-contract.ts`
- Create: `src/cad/kernel/occt-worker.ts`
- Create: `src/cad/kernel/occt-worker-client.ts`
- Create: `src/cad/kernel/occt-adapter.ts`
- Modify: `src/cad/runtime-contracts.ts`
- Create: `THIRD_PARTY_NOTICES.md`
- Test: `src/cad/kernel/occt-worker-client.test.ts`
- Test: `src/cad/kernel/occt-adapter.test.ts`

**Interfaces:**
- Consumes: `CadKernelAdapter.evaluate(request, signal, emit)` from `runtime-contracts.ts`.
- Produces: `createOcctCadAdapter(): CadKernelAdapter`; `OcctWorkerRequest` and `OcctWorkerEvent` discriminated unions keyed by `requestId`.

- [ ] **Step 1: Add failing adapter lifecycle tests**

```ts
it("cancels one rebuild without terminating later rebuilds", async () => {
  const adapter = createOcctCadAdapter(fakeWorkerFactory);
  const controller = new AbortController();
  const first = adapter.evaluate(request("first"), controller.signal, collect);
  controller.abort();
  await first;
  await adapter.evaluate(request("second"), new AbortController().signal, collect);
  expect(statesFor("first")).toEqual(["progress", "cancelled"]);
  expect(statesFor("second")).toContain("succeeded");
});
```

- [ ] **Step 2: Run the tests and verify missing worker modules fail**

Run: `pnpm vitest run src/cad/kernel/occt-worker-client.test.ts src/cad/kernel/occt-adapter.test.ts`
Expected: FAIL with unresolved module errors.

- [ ] **Step 3: Pin the kernel dependency and configure Vite**

Run: `pnpm add -E occt-wasm@4.3.2`

Exclude `occt-wasm` from dependency pre-bundling, retain `build.target: "esnext"`, and instantiate the kernel only inside `occt-worker.ts`. Record the OCCT/LGPL Wasm notice and ensure the Wasm remains a separately served, replaceable asset.

- [ ] **Step 4: Implement the worker client and adapter**

```ts
export type OcctWorkerRequest =
  | { readonly type: "evaluate"; readonly request: CadEvaluationRequest }
  | { readonly type: "cancel"; readonly requestId: string };

export function createOcctCadAdapter(factory = defaultOcctWorkerFactory): CadKernelAdapter;
```

Validate every inbound and outbound message. Map worker initialization, memory exhaustion, feature failure, invalid solid, cancellation, and protocol mismatch to existing `CadEvaluationEventSchema` states. Reuse one worker, serialize kernel access, and terminate it only after an unrecoverable protocol or device error.
Export `CadOutput` from `runtime-contracts.ts` as the inferred type of
`CadOutputSchema` so workspace consumers do not duplicate the union.

- [ ] **Step 5: Run adapter tests and production build**

Run: `pnpm vitest run src/cad/kernel/occt-worker-client.test.ts src/cad/kernel/occt-adapter.test.ts && pnpm build`
Expected: PASS; Vite emits the OCCT Wasm asset without worker externalization errors.

- [ ] **Step 6: Commit the kernel bridge**

```bash
git add package.json pnpm-lock.yaml vite.config.ts THIRD_PARTY_NOTICES.md src/cad/runtime-contracts.ts src/cad/kernel
git commit -m "feat(cad): add exact OCCT worker adapter"
```

### Task 3: Exact feature rebuild and semantic tessellation

**Files:**
- Create: `src/cad/kernel/feature-rebuild.ts`
- Create: `src/cad/kernel/semantic-tessellation.ts`
- Create: `src/cad/kernel/persistent-references.ts`
- Create: `src/cad/kernel/step-exchange.ts`
- Modify: `src/cad/kernel/occt-worker.ts`
- Test: `src/cad/kernel/feature-rebuild.test.ts`
- Test: `src/cad/kernel/persistent-references.test.ts`
- Test: `src/cad/kernel/step-exchange.test.ts`

**Interfaces:**
- Consumes: exact modeling collections and an initialized `OcctBridge`.
- Produces: `rebuildDocument(document, outputs, signal): Promise<CadRebuildPayload>` containing opaque B-rep bytes, semantic mesh buffers, mass properties, and optional STEP bytes.

- [ ] **Step 1: Write exact-operation and reference-stability tests**

Test an 80×40×10 mm extruded plate, a revolved boss, a through-cut, mass properties at unit density, and a STEP export/import round trip. Change only the plate width and require unaffected feature/body IDs to remain stable; require an ambiguous split face to return `reference-requires-repair`.

- [ ] **Step 2: Run focused tests and confirm they fail before rebuild exists**

Run: `pnpm vitest run src/cad/kernel/feature-rebuild.test.ts src/cad/kernel/persistent-references.test.ts src/cad/kernel/step-exchange.test.ts`
Expected: FAIL with missing rebuild exports.

- [ ] **Step 3: Implement ordered exact rebuild**

Resolve parameter expressions before kernel calls. Build closed wires from solved sketch geometry, execute features in document order, call OCCT validity checks after every solid-producing operation, and dispose superseded handles in `finally`. Never return the Three.js mesh CSG result from this path.

- [ ] **Step 4: Implement persistent semantic ownership**

```ts
export interface TopologySignature {
  readonly ownerFeatureId: string;
  readonly kind: "face" | "edge";
  readonly geometry: "plane" | "cylinder" | "cone" | "sphere" | "curve" | "other";
  readonly centroidM: readonly [number, number, number];
  readonly measureSI: number;
  readonly adjacentKinds: readonly string[];
}
```

Match first by feature lineage, then geometry type, quantized centroid/measure, and adjacency. Return a repair diagnostic when zero or multiple candidates satisfy tolerance. Tessellation must include per-triangle face IDs and per-polyline edge IDs.

- [ ] **Step 5: Run exact CAD tests**

Run: `pnpm vitest run src/cad/kernel && pnpm vitest run src/cad`
Expected: PASS with no leaked handles reported by the injected bridge ledger.

- [ ] **Step 6: Commit exact rebuild**

```bash
git add src/cad/kernel
git commit -m "feat(cad): rebuild exact semantic solids"
```

### Task 4: Browser exact-CAD gate

**Files:**
- Create: `src/cad/kernel/browser-cad-gate.ts`
- Create: `docs/testing/exact-cad-browser-gate.md`
- Modify: `src/app/useProjectState.ts`
- Test: `src/cad/kernel/browser-cad-gate.test.ts`

**Interfaces:**
- Consumes: `createOcctCadAdapter`, the current `DesignSession`, and artifact indexing.
- Produces: `runExactCadGate(signal): Promise<ExactCadGateResult>` with timings, hashes, mass/volume deltas, STEP round-trip deltas, and cancellation outcome.

- [ ] **Step 1: Write the gate contract test**

Require the gate to reject missing outputs, nonzero invalid-solid counts, mass/volume error above `1e-6` relative, STEP envelope error above `1e-6` relative, stale artifacts, or a cancellation that later emits success.

- [ ] **Step 2: Implement the gate and visible project-state failure**

The browser gate authors the plate/boss/cut document through transactions, rebuilds it, changes a dimension, rebuilds again, exports/imports STEP, cancels one rebuild, and completes a final rebuild. Surface unsupported Wasm/worker conditions in the workbench instead of loading legacy geometry.

- [ ] **Step 3: Run automated checks**

Run: `pnpm vitest run src/cad/kernel src/app/useProjectState.test.tsx && pnpm build && git diff --check`
Expected: PASS.

- [ ] **Step 4: Run the live browser gate**

Run: `pnpm dev --host 127.0.0.1`
Verify in a WebGPU-capable browser that the OCCT worker loads from the production-shaped origin, the exact part renders, a dimension rebuild changes geometry, cancellation is visible, STEP round-trip passes, and the console has no errors. Record measured results in `docs/testing/exact-cad-browser-gate.md`; do not mark unavailable checks as passed.

- [ ] **Step 5: Commit the browser proof**

```bash
git add src/cad/kernel/browser-cad-gate.ts src/cad/kernel/browser-cad-gate.test.ts src/app/useProjectState.ts docs/testing/exact-cad-browser-gate.md
git commit -m "test(cad): prove exact browser rebuild path"
```
