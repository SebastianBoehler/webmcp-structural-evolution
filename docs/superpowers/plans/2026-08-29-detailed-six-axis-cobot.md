# Detailed Six-Axis Cobot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-part robot-link proxy with a recognizable, 52-part SE-6 six-axis cobot whose upper arm is compiled and displayed as the only topology-optimized member.

**Architecture:** Keep the component, assembly, study, and solver contracts domain-neutral. Add a fixture-owned visual adapter behind an injected renderer seam, construct the original cobot from small catalog/assembly/study modules, and keep the topology domain aligned with the shoulder-to-elbow member so generated voxels remain physically installed in the complete arm.

**Tech Stack:** TypeScript 7, React 19, Three.js 0.185, Zod 4, Vitest 4, Rust/Wasm reference solver, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-29-detailed-six-axis-cobot-design.md`

## Global Constraints

- The fixture is an original Sunderlabs design; every engineering value is `qualified-assumption` provenance.
- Authored geometry uses millimetres, mass uses kilograms, and the solver boundary uses SI units explicitly.
- The assembly has six distinct joint axes and exactly 52 placed semantic instances.
- Only the J2-to-J3 upper arm is solved; the result is labelled `interactive sparse-lattice estimate`.
- Load-case IDs are exactly `rated-payload-gravity`, `emergency-stop`, and `lateral-disturbance`.
- No fixture-ID branch may enter generic compiler, solver, workspace, or renderer modules.
- Missing geometry, invalid transforms, ownership gaps, and solve failures remain visible errors; no placeholders or mock results.
- Hand-authored source files remain below the repository's 300-line soft limit.
- Production deployment remains blocked until the local desktop and narrow-viewport visual gates pass.

---

### Task 1: Inject a fixture-owned visual renderer

**Files:**
- Modify: `src/assembly/assembly-workspace-model.ts`
- Modify: `src/assembly/use-assembly-workspace.ts`
- Test: `src/assembly/use-assembly-workspace.test.tsx`

**Interfaces:**
- Produces: `AssemblyVisualRenderer(draft, catalog, resources): readonly AssemblyVisualPart[]`.
- Produces: `AssemblyWorkspaceOptions.renderParts?: AssemblyVisualRenderer`.
- Preserves: `renderPartsForAssembly` as the default renderer.

- [ ] **Step 1: Write the failing renderer-injection test**

Add a test that passes a renderer returning one literal part and asserts `result.current.parts` is that result:

```ts
const customPart: AssemblyVisualPart = {
  id: "custom-visual", selectionId: "fixture", label: "Custom fixture visual",
  appearance: "component", kind: "box", center: [10, 20, 30], size: [4, 5, 6],
};
const renderParts: AssemblyVisualRenderer = () => [customPart];
const { result } = renderHook(() => useAssemblyWorkspace({ initialState, inventory, renderParts }));
expect(result.current.parts).toEqual([customPart]);
```

- [ ] **Step 2: Run `pnpm test:run src/assembly/use-assembly-workspace.test.tsx` and verify the missing option/type failure.**

- [ ] **Step 3: Add the renderer type and use `options.renderParts ?? renderPartsForAssembly` inside the workspace memo.**

```ts
export type AssemblyVisualRenderer = (
  draft: AssemblyDraft,
  catalog: readonly ComponentDefinition[],
  resources: Readonly<Record<string, ComponentRenderResource>>,
) => readonly AssemblyVisualPart[];
```

- [ ] **Step 4: Re-run the focused test and verify it passes without changing default drone output.**

- [ ] **Step 5: Commit `feat(workspace): inject fixture visual renderer`.**

### Task 2: Build the qualified SE-6 catalog and 52-part assembly

**Files:**
- Create: `src/samples/cobot/cobot-values.ts`
- Create: `src/samples/cobot/cobot-catalog.ts`
- Create: `src/samples/cobot/cobot-assembly.ts`
- Create: `src/samples/cobot/cobot-assembly.test.ts`

**Interfaces:**
- Produces: `SE6_CATALOG: readonly ComponentDefinition[]`.
- Produces: `se6Assembly: AssemblyDraft`.
- Produces: `SE6_INSTANCE_GROUPS` with `base`, `shoulder`, `upperArm`, `forearm`, `wrist`, `tooling`, and `services` instance IDs.
- Produces helpers `mmPoint`, `transformMm`, `boxVolumeMm`, `cylinderVolumeMm`, and `qualifiedProvenance` used only by cobot modules.

- [ ] **Step 1: Write failing assembly-contract tests with literal expectations.**

```ts
expect(se6Assembly.components).toHaveLength(52);
expect(Object.values(SE6_INSTANCE_GROUPS).flat()).toHaveLength(52);
expect(new Set(SE6_INSTANCE_GROUPS.wrist.filter((id) => /^j[456]-/.test(id)).map((id) => id.slice(0, 2))))
  .toEqual(new Set(["j4", "j5", "j6"]));
expect(evaluateInventory(SE6_INVENTORY, se6Assembly).status).toBe("buildable");
expect(inspectAssemblyConflicts(se6Assembly, SE6_CATALOG, SE6_INVENTORY)).toEqual([]);
```

Also assert the mounted chain's literal anchor centers: shoulder `[0, 0, 340]`, elbow `[420, 0, 340]`, wrist `[650, 0, 520]`, and payload distal to the gripper.

- [ ] **Step 2: Run the focused test and verify module-not-found failure.**

- [ ] **Step 3: Define small reusable component classes for plate, shell, joint, fastener, cable, tooling, and payload.** Each definition carries qualified-assumption provenance, mass, local COM, envelope, collision volume, and at least one semantic interface.

- [ ] **Step 4: Author exactly 52 transformed requirements across the seven groups.** The upper arm remains horizontal from J2 to J3; the forearm bends upward so the full silhouette reads as an industrial arm while the solver domain stays axis-aligned.

- [ ] **Step 5: Derive inventory counts from the placed requirements and export `SE6_INVENTORY`.**

- [ ] **Step 6: Run the focused assembly tests and verify all literal geometry, inventory, and conflict assertions pass.**

- [ ] **Step 7: Commit `feat(cobot): add qualified SE-6 assembly`.**

### Task 3: Compile the upper-arm study and derived distal loads

**Files:**
- Create: `src/samples/cobot/cobot-study.ts`
- Create: `src/samples/cobot/cobot-study.test.ts`
- Modify: `src/optimization/assembly-study-compiler.ts`
- Modify: `src/optimization/assembly-study-compiler.test.ts`

**Interfaces:**
- Produces: `se6Study: StudySpec`.
- Produces: `SE6_DISTAL_MASS_KG` and `SE6_DISTAL_CENTER_M` derived from placed forearm, wrist, tooling, and service components.
- Extends generic compilation so `AssemblyDraft.preservedMounts` become `requiredSolids` without inspecting fixture IDs.

- [ ] **Step 1: Write failing compiler tests for the three named loads and SI values.**

```ts
expect(context.input.loadCases.map(({ id }) => id)).toEqual([
  "rated-payload-gravity", "emergency-stop", "lateral-disturbance",
]);
expect(context.input.protectedVoids).toEqual([
  expect.objectContaining({ kind: "cylinder", radiusM: 0.014 }),
]);
expect(context.input.accessVoids).toHaveLength(4);
expect(context.input.requiredSolids).toHaveLength(2);
expect(context.input.assemblyMassKg).toBeCloseTo(23.7, 1);
```

Assert gravity force equals `-SE6_DISTAL_MASS_KG * 9.80665`, emergency X force equals `-SE6_DISTAL_MASS_KG * 2 * 9.80665`, and lateral Y force equals `150`.

- [ ] **Step 2: Run the study/compiler tests and verify missing exports plus empty required-solids failure.**

- [ ] **Step 3: Derive distal mass and world COM from catalog mass accounting and assembly transforms, then construct the 360 × 130 × 110 mm design domain, bosses, 28 mm cable corridor, four access corridors, supports, PA12 material, and three load cases.**

- [ ] **Step 4: Convert preserved mounts generically to short cylindrical required solids using their diameter and the study minimum feature.**

- [ ] **Step 5: Re-run focused tests and verify normalized SI values, mass/COM, regions, and names pass.**

- [ ] **Step 6: Commit `feat(cobot): compile upper-arm structural study`.**

### Task 4: Add semantic materials and the detailed cobot visual adapter

**Files:**
- Modify: `src/viewer/render-envelope.ts`
- Modify: `src/viewer/assembly-meshes.ts`
- Modify: `src/viewer/assembly-meshes.test.ts`
- Create: `src/samples/cobot/cobot-visuals.ts`
- Create: `src/samples/cobot/cobot-visuals.test.ts`

**Interfaces:**
- Adds optional `material?: AssemblyMaterialToken` and `semanticGroup?: string` to `AssemblyVisualPart`.
- Produces `AssemblyMaterialToken = "structural" | "joint" | "cover" | "fastener" | "cable" | "tooling" | "payload"`.
- Produces `renderSe6Assembly: AssemblyVisualRenderer`.

- [ ] **Step 1: Write failing material and visual-contract tests.**

```ts
expect(parts.filter(({ appearance }) => appearance === "component")).toHaveLength(52);
expect(new Set(parts.map(({ semanticGroup }) => semanticGroup))).toEqual(new Set([
  "base", "shoulder", "upper-arm", "forearm", "wrist", "tooling", "services", undefined,
]));
expect(parts.find(({ id }) => id === "calibration-payload")).toMatchObject({
  material: "payload", semanticGroup: "tooling",
});
expect(prepareRenderModel(model).camera.span).toBeGreaterThan(800);
```

Assert every component visual owns an existing assembly instance, the design region center is `[210, 0, 340]`, and world bounds put base below shoulder, elbow before wrist, and payload after the gripper.

- [ ] **Step 2: Run focused tests and verify missing material/adapter failures.**

- [ ] **Step 3: Add the material tokens and a fixed palette in `assembly-meshes.ts`; preserve appearance colors for generated/design/constraint parts.**

- [ ] **Step 4: Implement `renderSe6Assembly` by projecting the 52 instance envelopes through the generic renderer, then assigning stable labels, groups, colors, selection ownership, and the upper-arm design-region label.** Invalid or missing ownership throws an error.

- [ ] **Step 5: Run focused viewer and cobot visual tests and verify the silhouette invariants and material rendering pass.**

- [ ] **Step 6: Commit `feat(cobot): render detailed semantic assembly`.**

### Task 5: Register SE-6 through the fixture and workspace seams

**Files:**
- Create: `src/samples/cobot/cobot-fixture.ts`
- Modify: `src/samples/demo-fixtures.ts`
- Modify: `src/samples/demo-fixtures.test.ts`
- Modify: `src/app/FoundationJourney.tsx`
- Modify: `src/app/FoundationJourney.test.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/webmcp/assembly-template-tools.test.tsx`
- Delete: `src/samples/robot-arm-link.ts`
- Delete: `src/samples/robot-arm-link.test.ts`

**Interfaces:**
- Replaces fixture ID `robot-arm-link` with `se6-cobot`.
- Adds `renderParts?: AssemblyVisualRenderer` to `DemoFixture`.
- Produces `SE6_COBOT_FIXTURE` with workspace, context, study, inventory, and renderer.

- [ ] **Step 1: Change tests first to select `se6-cobot` and assert label `SE-6 six-axis cobot`, topology subject `upper arm`, three named loads, and 52 visible component parts.**

- [ ] **Step 2: Run the fixture, app, journey, and WebMCP tests and verify the old fixture ID/label failures.**

- [ ] **Step 3: Compose the fixture snapshot and register it in `DEMO_FIXTURES`; pass `fixture.renderParts` into `useAssemblyWorkspace` from `FoundationJourney`.**

- [ ] **Step 4: Remove the obsolete three-component proxy and update exact test inputs/results to `se6-cobot`.**

- [ ] **Step 5: Run all focused fixture/UI/WebMCP tests and verify the drone fixture tests remain green.**

- [ ] **Step 6: Commit `feat(cobot): expose SE-6 workbench fixture`.**

### Task 6: Keep generated topology installed in the upper arm

**Files:**
- Modify: `src/app/use-visible-assembly-parts.ts`
- Modify: `src/app/TopologyResultPanel.tsx`
- Test: `src/app/FoundationJourney.test.tsx`
- Test: `src/viewer/FieldViewer.test.tsx`
- Modify: `src/reference/full-assembly.integration.test.ts`

**Interfaces:**
- Preserves the complete contextual arm when `hasTopology` is true.
- Hides only the authored `design-region` while displaying generated density at the matching grid coordinates.
- Uses the fixture load-case IDs and `upper arm` copy in result/export receipts.

- [ ] **Step 1: Add failing tests asserting the elbow, wrist, gripper, and payload remain visible after a verified SE-6 candidate is supplied, while the authored design region is hidden.**

- [ ] **Step 2: Run the focused tests and confirm any context-hiding or copy mismatch failure.**

- [ ] **Step 3: Make the smallest visibility/copy changes needed; do not special-case the fixture ID.**

- [ ] **Step 4: Re-run the focused tests and verify the installed upper-arm context passes.**

- [ ] **Step 5: Replace the old proxy integration case with a real Wasm SE-6 solve.** Assert all three load-case IDs survive, density and per-case analysis lengths match `48 × 32 × 16`, protected/access voxels stay below threshold, and a six-neighbor path at density `>= 0.32` connects the two boss regions. The 32-cell second axis is the enforced minimum of the shipped Wasm solver.

- [ ] **Step 6: Run `pnpm wasm:build && pnpm test:run src/reference/full-assembly.integration.test.ts` and require the locked solve to pass within its 90-second test budget.**

- [ ] **Step 7: Commit `fix(cobot): retain assembly context around topology`.**

### Task 7: Verify the real browser and project gates

**Files:**
- Modify only if a verified defect is found by the gates below.

**Interfaces:**
- No new production interface.
- Produces local visual evidence and a clean verified branch, not a production deployment.

- [ ] **Step 1: Run `pnpm test:run src/samples/cobot src/samples/demo-fixtures.test.ts src/optimization/assembly-study-compiler.test.ts src/assembly/use-assembly-workspace.test.tsx src/app/FoundationJourney.test.tsx src/app/App.test.tsx src/webmcp/assembly-template-tools.test.tsx`.**

- [ ] **Step 2: Run `pnpm check` and require Vitest, TypeScript/Vite, Wasm build, and Rust tests to pass.**

- [ ] **Step 3: Start the local Vite app and inspect the real SE-6 fixture at desktop and narrow widths.** Verify the seven recognizable regions, full framing, mounted payload, detail density, attached upper-arm topology, semantic selection, and honest result copy.

- [ ] **Step 4: Exercise WebMCP fixture generation and design inspection against the local page; verify returned fixture ID, hierarchy, load cases, and active upper-arm study.**

- [ ] **Step 5: If a visual or browser defect appears, add the narrowest failing regression test before applying the fix, then repeat Steps 1–4.**

- [ ] **Step 6: Run `git diff --check`, inspect the complete branch diff, confirm no source file exceeds 300 lines because of this work, and commit any browser-gate fixes with a scoped conventional message.**

- [ ] **Step 7: Stop before push/deployment and present the verified local result for visual acceptance.**
