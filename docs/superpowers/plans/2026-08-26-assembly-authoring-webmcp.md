# Assembly Authoring and WebMCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inspect, place, and constrain catalog components, expose deterministic conflicts, and let WebMCP agents author the same visible assembly as humans.

**Architecture:** An immutable authoring reducer owns exact revisions and constraints. Derived conflicts and render parts are pure views; React and WebMCP call the same reducer-backed services.

**Tech Stack:** TypeScript 7, Zod 4, React 19, Three.js 0.185, Vitest, WebMCP imperative tools.

**Spec:** `docs/superpowers/specs/2026-08-26-agent-authored-component-ingestion.md`

## Global Constraints
- First complete `2026-08-26-agent-authored-assembly.md`.
- Keep every source file at or below 300 LOC.
- Mutations require exact parent revisions and produce staged branches.
- Arbitrary code, unrestricted URLs, purchases, promotion, and export are never tool-callable.
- Human and agent actions update the same scene, selection, inspector, and conflict list.

---

### Task 1: Add deterministic assembly constraints and conflict inspection

**Files:**
- Create: `src/assembly/assembly-authoring.ts`
- Create: `src/assembly/assembly-authoring.test.ts`
- Create: `src/assembly/assembly-conflicts.ts`
- Create: `src/assembly/assembly-conflicts.test.ts`

**Interfaces:**
- Consumes: `ComponentDefinition`, `AssemblyDraft`, and semantic interfaces from the component plan.
- Produces: `applyAssemblyAction(state, action)`, `solveAssemblyConstraints(draft)`, and `inspectAssemblyConflicts(draft, catalog, inventory)`.

- [ ] **Step 1: Write failing constraint tests**

```ts
it("mates a motor axis to the arm mount without guessed coordinates", () => {
  const solved = solveAssemblyConstraints(draftWithConcentricMotorMate);
  expect(solved.instances.motor.transform.positionMm).toEqual([105, 0, 6]);
  expect(solved.unresolvedDegreesOfFreedom.motor).toEqual([]);
});

it("reports collision, missing stock, and inaccessible hardware separately", () => {
  expect(inspectAssemblyConflicts(collidingDraft, catalog, inventory).map(x => x.kind))
    .toEqual(["collision", "insufficient-stock", "tool-access"]);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/assembly/assembly-authoring.test.ts src/assembly/assembly-conflicts.test.ts`

Expected: FAIL because authoring services are absent.

- [ ] **Step 3: Implement graph propagation and typed conflicts**

```ts
export type AssemblyAction =
  | { kind: "place"; parentRevision: string; instance: ComponentInstance }
  | { kind: "constrain"; parentRevision: string; constraint: AssemblyConstraint }
  | { kind: "protect"; parentRevision: string; region: ProtectedRegion };

export function inspectAssemblyConflicts(...): readonly AssemblyConflict[] {
  return freezeSnapshot([...mountConflicts(...), ...collisionConflicts(...), ...accessConflicts(...)]
    .sort(compareConflict));
}
```

- [ ] **Step 4: Run assembly tests**

Run: `pnpm vitest run src/assembly/assembly-authoring.test.ts src/assembly/assembly-conflicts.test.ts src/assembly/drone-workspace.test.ts`

Expected: PASS with deterministic ordering.

- [ ] **Step 5: Commit**

```bash
git add src/assembly/assembly-authoring* src/assembly/assembly-conflicts*
git commit -m "feat(assembly): solve mates and expose assembly conflicts"
```

### Task 2: Replace visual-only workspace state with the assembly reducer

**Files:**
- Modify: `src/assembly/use-assembly-workspace.ts`
- Modify: `src/assembly/drone-workspace.ts`
- Modify: `src/app/ComponentBrowser.tsx`
- Modify: `src/app/ImportReview.tsx`
- Test: `src/assembly/use-assembly-workspace.test.tsx`

**Interfaces:**
- Consumes: Task 1 reducer and conflict inspector.
- Produces: `stageComponent`, `placeComponent`, `constrainComponent`, `protectRegion`, `compileAssembly`, and human approval methods.

- [ ] **Step 1: Write a failing hook journey**

```tsx
await act(() => result.current.stageComponent(packageComponent, revision));
await act(() => result.current.placeComponent(instance, result.current.revision));
expect(result.current.parts.some(part => part.selectionId === instance.id)).toBe(true);
expect(result.current.conflicts).toEqual([]);
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/assembly/use-assembly-workspace.test.tsx`

Expected: FAIL because the hook exposes visual arrays rather than authoring actions.

- [ ] **Step 3: Integrate reducer-derived visuals**

```ts
const [workspace, dispatch] = useReducer(assemblyReducer, initialDroneWorkspace);
const parts = useMemo(() => renderPartsForAssembly(workspace.draft, workspace.catalog), [workspace]);
const conflicts = useMemo(() => inspectAssemblyConflicts(workspace.draft, workspace.catalog, workspace.inventory), [workspace]);
```

- [ ] **Step 4: Run workspace and UI tests**

Run: `pnpm vitest run src/assembly src/app/InspectorPanel.test.tsx src/app/App.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assembly src/app/ComponentBrowser.tsx src/app/ImportReview.tsx
git commit -m "feat(app): make the viewport a revisioned assembly editor"
```

### Task 3: Expose typed WebMCP assembly-authoring actions

**Files:**
- Create: `src/webmcp/assembly-schemas.ts`
- Create: `src/webmcp/assembly-executors.ts`
- Modify: `src/webmcp/component-tools.tsx`
- Modify: `src/app/WorkbenchAgentTools.tsx`
- Test: `src/webmcp/assembly-executors.test.ts`
- Test: `src/webmcp/component-tools.test.tsx`

**Interfaces:**
- Produces tools: `inspect_assembly_context`, `preview_assembly_edit`, `stage_component_definition`, `place_component`, `constrain_component`, `define_protected_region`, `inspect_assembly_conflicts`, `compile_assembly`.

- [ ] **Step 1: Write failing executor tests**

```ts
it("rejects a stale placement and leaves the viewport unchanged", async () => {
  const result = await placeComponent({ parentRevision: stale, componentRevision, transform }, services);
  expect(result.isError).toBe(true);
  expect(services.getState().revision).toBe(current);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/webmcp/assembly-executors.test.ts src/webmcp/component-tools.test.tsx`

Expected: FAIL because the new tools are not registered.

- [ ] **Step 3: Implement inspect-first, narrow shared-service executors**

```ts
export const PlaceComponentInputSchema = z.object({
  parentRevision: RevisionSchema,
  componentRevision: RevisionSchema,
  instanceId: SafeIdentifierSchema,
  transform: TransformMmSchema,
}).strict();
```

Return exact revisions, conflicts, visible selection, and valid next actions. Do not return raw component source documents.

`inspect_assembly_context` returns a compact scene inventory, semantic relationships,
unresolved degrees of freedom, collisions, stock gaps, and current camera/selection.
`preview_assembly_edit` calculates the exact state delta and conflicts without mutating
the scene. Write tools require that preview revision and leave a visible receipt. This
adapts Blender Lab MCP's strongest pattern—natural-language scene analysis and approved
edits—without its arbitrary Python execution path.

- [ ] **Step 4: Run WebMCP tests**

Run: `pnpm vitest run src/webmcp`

Expected: PASS; dynamic registration exposes only actions valid for the current revision and review state.

- [ ] **Step 5: Commit**

```bash
git add src/webmcp src/app/WorkbenchAgentTools.tsx
git commit -m "feat(webmcp): let agents author visible assemblies"
```

### Task 4: Verify the agent-authored assembly vertical slice

**Files:**
- Modify: `docs/testing/webmcp-foundation-evals.json`
- Create: `docs/testing/agent-authored-assembly-gate.md`

**Interfaces:**
- Verifies all component and authoring tasks together.

- [ ] **Step 1: Add the exact eval journey**

```json
{
  "prompt": "Create the supplied motor definition, place four instances, mate them to the arm mounts, protect each propeller envelope, and report unresolved conflicts.",
  "expected_tools": ["inspect_assembly_context", "preview_assembly_edit", "stage_component_definition", "place_component", "constrain_component", "define_protected_region", "inspect_assembly_conflicts"]
}
```

- [ ] **Step 2: Run the complete local gate**

Run: `pnpm check`

Expected: all TypeScript, Vitest, Vite, Wasm, and Rust checks pass.

- [ ] **Step 3: Exercise the journey in the in-app browser**

Run: `pnpm dev --host 127.0.0.1`

Expected: agent-created parts appear immediately; stale mutations fail visibly; there is no page scroll or console error.

- [ ] **Step 4: Commit evidence**

```bash
git add docs/testing
git commit -m "test(webmcp): gate agent-authored assembly workflow"
```
