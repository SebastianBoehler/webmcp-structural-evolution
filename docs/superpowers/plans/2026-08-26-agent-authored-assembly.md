# Agent-Authored Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let humans and agents import verified component packages or create safe bounded parametric components.

**Architecture:** Split the near-limit domain file into focused modules, validate portable component ZIP packages, and compile a bounded geometry graph through lazy CSG dependencies. This plan produces the component catalog consumed by the assembly-authoring plan.

**Tech Stack:** TypeScript 7, Zod 4, React 19, Three.js 0.185, fflate 0.8.3, three-mesh-bvh 0.9.14, three-bvh-csg 0.0.18, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-agent-authored-component-ingestion.md`

## Global Constraints

- Keep every source file at or below the repository's 300 LOC soft limit.
- Use SI units internally; preserve source units and provenance at ingestion.
- Never execute imported JavaScript, Python, WGSL, Wasm, or arbitrary CAD scripts.
- Agent mutations are staged revisions; humans approve candidate promotion and export.
- UI and WebMCP actions call the same domain services and reject stale parent revisions.
- Large binary assets enter through the visible file UI or a future MCP bridge, not WebMCP base64 arguments.

---

### Task 1: Split and extend the engineering domain model

**Files:**
- Create: `src/domain/engineering-units.ts`
- Create: `src/domain/component-model.ts`
- Create: `src/domain/assembly-model.ts`
- Modify: `src/domain/design.ts`
- Test: `src/domain/component-model.test.ts`
- Test: `src/domain/assembly-model.test.ts`

**Interfaces:**
- Produces: `ComponentDefinitionSchema`, `ComponentGeometrySchema`, `SemanticInterfaceSchema`, `AssemblyDraftSchema`, `defineComponent()`, `defineAssemblyDraft()`.
- Preserves: existing imports from `src/domain/design.ts` through re-exports.

- [ ] **Step 1: Write failing schema tests**

```ts
it("rejects executable component geometry", async () => {
  await expect(defineComponent({ ...validComponent, geometry: { kind: "script", code: "fetch('/')" } }))
    .rejects.toThrow();
});

it("keeps component interfaces in component-local SI coordinates", async () => {
  const component = await defineComponent(validComponent);
  expect(component.interfaces[0]).toMatchObject({ kind: "mount", coordinates: "component-local" });
  expect(component.mass.unit).toBe("kg");
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `pnpm vitest run src/domain/component-model.test.ts src/domain/assembly-model.test.ts`

Expected: FAIL because the split modules and expanded schemas do not exist.

- [ ] **Step 3: Implement focused schema modules**

```ts
export const ComponentGeometrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), assetId: DigestSchema, mediaType: CadMediaTypeSchema, units: LengthUnitSchema }).strict(),
  z.object({ kind: z.literal("parametric"), graph: ParametricGraphSchema }).strict(),
]);

export const SemanticInterfaceSchema = z.discriminatedUnion("kind", [
  MountInterfaceSchema, MateInterfaceSchema, CableInterfaceSchema,
  AccessInterfaceSchema, CoolingInterfaceSchema, LoadInterfaceSchema,
]);
```

Move unit, geometry, component, and assembly schemas out of `design.ts`; keep `design.ts` as a compatibility re-export plus inventory evaluation.

- [ ] **Step 4: Run domain tests**

Run: `pnpm vitest run src/domain/design.test.ts src/domain/component-model.test.ts src/domain/assembly-model.test.ts`

Expected: PASS, including the old domain fixtures.

- [ ] **Step 5: Commit**

```bash
git add src/domain
git commit -m "refactor(domain): split engineering assembly contracts"
```

### Task 2: Parse and verify portable component packages

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/assembly/component-package.ts`
- Create: `src/assembly/component-package.test.ts`

**Interfaces:**
- Consumes: `ComponentDefinitionSchema` from Task 1.
- Produces: `parseComponentPackage(file: File): Promise<ParsedComponentPackage>` and `digestAsset(bytes: Uint8Array): Promise<string>`.

- [ ] **Step 1: Add failing package tests**

```ts
it("rejects a package whose asset digest differs from the manifest", async () => {
  const file = packageFixture({ declaredDigest: "0".repeat(64), asset: new Uint8Array([1, 2, 3]) });
  await expect(parseComponentPackage(file)).rejects.toThrow("digest");
});

it("rejects zip traversal and unsupported entries", async () => {
  await expect(parseComponentPackage(packageWithEntry("../escape.step"))).rejects.toThrow("entry path");
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/assembly/component-package.test.ts`

Expected: FAIL because `parseComponentPackage` is undefined.

- [ ] **Step 3: Add the focused ZIP dependency and parser**

Run: `pnpm add fflate@0.8.3`

```ts
export async function parseComponentPackage(file: File): Promise<ParsedComponentPackage> {
  if (file.size > MAX_PACKAGE_BYTES) throw new RangeError("Component package exceeds 50 MB");
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  assertSafeEntries(entries);
  const manifest = ComponentPackageManifestSchema.parse(JSON.parse(str(entries["component.json"]!)));
  await verifyDeclaredDigests(entries, manifest.assets);
  return freezeSnapshot({ manifest, assets: selectDeclaredAssets(entries, manifest.assets) });
}
```

- [ ] **Step 4: Run import tests**

Run: `pnpm vitest run src/assembly/component-package.test.ts src/assembly/component-import.test.ts src/assembly/step-import.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/assembly/component-package*
git commit -m "feat(assembly): validate portable component packages"
```

### Task 3: Compile bounded parametric geometry

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/assembly/parametric-geometry.ts`
- Create: `src/assembly/parametric-geometry.test.ts`
- Modify: `src/viewer/render-envelope.ts`

**Interfaces:**
- Consumes: `ParametricGraph` from Task 1.
- Produces: `compileParametricGeometry(graph): Promise<CadMesh>`.

- [ ] **Step 1: Write failing geometry tests**

```ts
it("subtracts a four-hole motor pattern from a bounded plate", async () => {
  const mesh = await compileParametricGeometry(motorPlateGraph);
  expect(mesh.sizeMm).toEqual([32, 32, 5]);
  expect(countConnectedComponents(mesh)).toBe(1);
});

it("rejects graphs over the operation budget", async () => {
  await expect(compileParametricGeometry(graphWithNodes(257))).rejects.toThrow("256 operations");
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/assembly/parametric-geometry.test.ts`

Expected: FAIL because the compiler does not exist.

- [ ] **Step 3: Add lazy CSG dependencies and compiler**

Run: `pnpm add three-mesh-bvh@0.9.14 three-bvh-csg@0.0.18`

```ts
export async function compileParametricGeometry(graph: ParametricGraph): Promise<CadMesh> {
  ParametricGraphSchema.parse(graph);
  if (graph.nodes.length > 256) throw new RangeError("Parametric graph exceeds 256 operations");
  const { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } = await import("three-bvh-csg");
  const geometry = evaluateGraph(graph, { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION });
  return cadMeshFromBufferGeometry(geometry);
}
```

- [ ] **Step 4: Run geometry and viewer tests**

Run: `pnpm vitest run src/assembly/parametric-geometry.test.ts src/viewer/assembly-meshes.test.ts`

Expected: PASS; initial Vite bundle does not eagerly contain CSG code.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/assembly/parametric-geometry* src/viewer/render-envelope.ts
git commit -m "feat(assembly): compile safe parametric component geometry"
```

### Task 4: Build the realistic reference drone catalog

**Files:**
- Create: `src/samples/reference-drone-catalog.ts`
- Create: `src/samples/reference-drone-catalog.test.ts`
- Create: `docs/sources/reference-drone-components.md`
- Modify: `src/assembly/drone-workspace.ts`

**Interfaces:**
- Produces realistic display, collision, interface, mass, provenance, and protected-envelope records for four 2207-class motors, a 30.5 mm flight-controller/ESC stack, battery, fasteners, wiring corridors, and 5-inch propeller envelopes.

- [ ] **Step 1: Write failing fidelity and provenance tests**

```ts
expect(REFERENCE_DRONE_CATALOG.every(x => x.provenance.sources.length > 0)).toBe(true);
expect(REFERENCE_DRONE_CATALOG.find(x => x.id === "motor-2207")?.geometry.kind).not.toBe("box");
expect(referenceDroneAssembly.instances.filter(x => x.componentId === "motor-2207")).toHaveLength(4);
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/samples/reference-drone-catalog.test.ts`

Expected: FAIL because the realistic catalog is absent.

- [ ] **Step 3: Author geometry from traceable mechanical specifications**

Use redistributed CAD only when its license explicitly permits inclusion. Otherwise,
build a detailed bounded parametric model from published mechanical dimensions and mark
it `modeled-from-specification`, including dimensional uncertainty. Propellers remain
visual/collision geometry and protected swept volumes; they are not optimized material.

- [ ] **Step 4: Replace simple product fixtures and verify the viewer**

Run: `pnpm vitest run src/samples/reference-drone-catalog.test.ts src/viewer src/assembly`

Expected: PASS; the assembly shows four detailed motors, the avionics stack, fasteners,
wiring corridors, and correct protected envelopes without treating them as structure.

- [ ] **Step 5: Commit**

```bash
git add src/samples src/assembly/drone-workspace.ts docs/sources/reference-drone-components.md
git commit -m "feat(samples): add traceable drone component catalog"
```

Execution continues in `2026-08-26-assembly-authoring-webmcp.md`.
