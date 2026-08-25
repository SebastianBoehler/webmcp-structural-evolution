# WebGPU and WebMCP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a judge-readable local application that proves deterministic Rust/Wasm validation, correct WebGPU buffer computation, live 3D rendering, immutable design snapshots, and state-aware WebMCP collaboration before building the full FEM optimizer.

**Architecture:** A static Vite/React application owns immutable project state. A direct WebGPU module runs and verifies a deterministic 3D compute probe; a Rust/Wasm package supplies the independent numerical comparator. Three.js renders the same computed field, while WebMCP tools call the same typed domain services as the UI and create visible receipts.

**Tech Stack:** Node 24.19.0, pnpm 10.15.0, Vite 8.2.2, React 19.2.8, TypeScript 7.0.2, Three.js 0.185.1, Zod 4.4.3, Vitest 4.1.11, Rust stable, wasm-bindgen 0.2.127, WebGPU/WGSL, imperative WebMCP, and Chrome's `use-webmcp-tool` 0.2.0 React hook.

**Spec:** `docs/superpowers/specs/2026-08-26-agentic-structural-evolution-design.md`

## Global Constraints

- Use Apache-2.0 and keep every source file below the 300-line soft limit.
- No account, backend, mock solver output, silent fallback, arbitrary code, arbitrary URLs, or NASA branding.
- Unsupported WebGPU, invalid inputs, shader errors, and numerical mismatch fail visibly.
- Saved fixtures contain input problems only; every displayed compute result must come from the shipped compute path.
- UI and WebMCP use the same domain functions and immutable revision IDs.
- Human acceptance/export remains outside agent-callable tools.
- Keep controls, errors, evidence, and numerical alternatives in semantic DOM; the 3D canvas is not the sole carrier of meaning.
- Keep work over 250 ms off the main thread, size the canvas to device pixels, respect reduced motion, and dispose every GPU/viewer resource.
- WebMCP stays origin-isolated, top-level/same-origin only, and visibly unsupported when absent; do not expose tools cross-origin.
- Follow Chrome's tool budgets: names and parameter names at most 30 characters, tool descriptions at most 500, parameter descriptions at most 150, and each tool output at most 1,500.
- Mark read-only tools with `readOnlyHint`, label external or user-authored text with `untrustedContentHint`, validate every input in-page, and return minimum necessary facts.
- Use Node 24.19.0 because Vitest 4 excludes Node 23; the bundled runtime is available at `/Users/sebastianboehler/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`.

## Authoritative implementation references

- The current `webmachinelearning/webmcp` explainer and implementation status define the browser API, document lifetime, abort semantics, permissions policy, and active open questions.
- Chrome's WebMCP developer docs and origin-trial guide define Chrome 149 setup, origin isolation, and progressive enhancement.
- Chrome's security guide defines annotation hints, exposure boundaries, prompt-injection assumptions, and character budgets.
- Chrome's WebMCP eval guidance and `GoogleChromeLabs/webmcp-tools` demos define deterministic smoke tests, probabilistic selection evals, complete state tool lists, ordered chains, and mid-chain failures.
- Chrome DevTools' WebMCP pane is the manual source of truth for registered tools, exact inputs/outputs, cancellation, errors, and invocation history.
- GoogleChrome's `modern-web-guidance` skill governs semantic structure, accessibility, performance, responsive canvas sizing, and main-thread work.

---

## File map

- Root configs: package metadata, TypeScript, Vite, Vitest, licence, and ignore rules.
- `src/domain/`: exact component/study snapshots, canonical serialization, revisions, and receipts.
- `src/samples/`: input-only drone-arm feasibility fixture.
- `crates/reference/`: Rust numerical comparison compiled to Wasm.
- `src/gpu/`: capability checks, WGSL probe, buffer orchestration, and result verification.
- `src/viewer/`: Three.js scene and pure instance extraction.
- `src/webmcp/`: browser types, dynamic registration, schemas, and shared tool executors.
- `src/app/`: judge shell, project state hook, evidence panels, and receipts.
- `src/test/`: test setup and browser API fakes.

### Task 1: Reproducible application shell

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `LICENSE`
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/app/app.css`, `src/test/setup.ts`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `App(): JSX.Element`, scripts `dev`, `build`, `test`, `test:run`, `wasm:build`, and `check`.

- [ ] **Step 1: Create the package contract and failing shell test**

```json
{
  "name": "webmcp-structural-evolution",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.15.0",
  "engines": { "node": "24.19.0" },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest",
    "test:run": "vitest run",
    "wasm:build": "wasm-pack build crates/reference --target web --out-dir ../../src/reference/pkg",
    "check": "pnpm wasm:build && pnpm test:run && pnpm build && cargo test --manifest-path crates/reference/Cargo.toml"
  },
  "dependencies": { "react": "19.2.8", "react-dom": "19.2.8", "three": "0.185.1", "zod": "4.4.3" },
  "devDependencies": { "@testing-library/react": "16.3.2", "@types/node": "26.3.0", "@types/react": "19.2.18", "@types/react-dom": "19.2.5", "@types/three": "0.185.4", "@vitejs/plugin-react": "6.1.0", "@webgpu/types": "0.1.72", "jsdom": "30.0.1", "typescript": "7.0.2", "vite": "8.2.2", "vitest": "4.1.11" }
}
```

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({ plugins: [react()], server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } } });

// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], restoreMocks: true } });
```

```tsx
render(<App />);
expect(screen.getByRole("heading", { name: /structural evolution/i })).toBeVisible();
expect(screen.getByRole("button", { name: /run foundation probe/i })).toBeDisabled();
```

- [ ] **Step 2: Prepend the bundled Node 24 directory to `PATH`, verify `node --version` is `v24.19.0`, then run `pnpm install && pnpm test:run`; expect the missing `App` test to fail.**
- [ ] **Step 3: Implement the semantic shell, error boundary, capability-status region, and restrained technical visual system.**
- [ ] **Step 4: Run `pnpm test:run && pnpm build`; expect both to pass.**
- [ ] **Step 5: Commit with `git commit -m "feat(app): scaffold structural workbench shell"`.**

### Task 2: Exact immutable snapshots

**Files:**
- Create: `src/domain/design.ts`, `src/domain/canonical-json.ts`, `src/domain/revisions.ts`, `src/domain/receipts.ts`
- Create: `src/samples/drone-arm-foundation.ts`
- Test: `src/domain/revisions.test.ts`, `src/samples/drone-arm-foundation.test.ts`

**Interfaces:**
- Produces: `ComponentDefinition`, `AssemblySpec`, `StudySpec`, `ActionReceipt`, `canonicalJson(value)`, `revisionId(value): Promise<string>`, `evaluateInventory(inventory, assembly)`, `DRONE_ARM_FOUNDATION_STUDY`.

- [ ] **Step 1: Write failing tests for key-order-independent hashes, unit-preserving component revisions, insufficient stock, and exact mount/keep-out counts.**

```ts
expect(await revisionId({ b: 2, a: 1 })).toBe(await revisionId({ a: 1, b: 2 }));
expect(await revisionId({ mass: { value: 24, unit: "g" } })).not.toBe(
  await revisionId({ mass: { value: 24, unit: "kg" } }),
);
expect(evaluateInventory(fixture.inventory, fixture.assembly).status).toBe("insufficient-stock");
```

- [ ] **Step 2: Run `pnpm vitest run src/domain/revisions.test.ts`; expect missing exports.**
- [ ] **Step 3: Implement discriminated units, Zod-validated records, recursive canonical key sorting, SHA-256 revision IDs, inventory evaluation, and the input-only fixture.**
- [ ] **Step 4: Run `pnpm vitest run src/domain src/samples`; expect all tests to pass.**
- [ ] **Step 5: Commit with `git commit -m "feat(domain): add exact design snapshots"`.**

### Task 3: Rust/Wasm numerical oracle

**Files:**
- Create: `crates/reference/Cargo.toml`, `crates/reference/src/lib.rs`
- Create: `src/reference/index.ts`
- Test: Rust unit tests in `crates/reference/src/lib.rs`, `src/reference/index.test.ts`

**Interfaces:**
- Produces: Rust/Wasm `relative_l2(expected: &[f32], actual: &[f32]) -> Result<f32, JsValue>` and TypeScript `relativeL2(expected: Float32Array, actual: Float32Array): Promise<number>`.

- [ ] **Step 1: Install the pinned builder with `cargo install wasm-pack --version 0.15.0 --locked` and add target `wasm32-unknown-unknown`.**
- [ ] **Step 2: Write Rust tests for exact equality, a known `sqrt(2)/sqrt(5)` ratio, length mismatch, empty vectors, and non-finite values.**

```rust
assert!((relative_l2_core(&[1.0, 2.0], &[2.0, 3.0]).unwrap() - (2.0_f32 / 5.0).sqrt()).abs() < 1e-6);
assert!(relative_l2_core(&[1.0], &[1.0, 2.0]).is_err());
```

- [ ] **Step 3: Run `cargo test --manifest-path crates/reference/Cargo.toml`; expect missing functions.**
- [ ] **Step 4: Implement the finite-input comparator, wasm-bindgen export, and lazy TypeScript loader with one shared initialization promise.**
- [ ] **Step 5: Run `cargo test`, `pnpm wasm:build`, and `pnpm vitest run src/reference`; expect all to pass.**
- [ ] **Step 6: Commit with `git commit -m "feat(reference): add wasm numerical oracle"`.**

### Task 4: Verified WebGPU compute probe

**Files:**
- Create: `src/gpu/capabilities.ts`, `src/gpu/compute-probe.ts`, `src/gpu/probe.wgsl`, `src/gpu/probe-contract.ts`
- Test: `src/gpu/probe-contract.test.ts`

**Interfaces:**
- Consumes: `relativeL2` from Task 3.
- Produces: `detectWebGpu(): Promise<GpuCapability>`, `runComputeProbe(input: ProbeInput): Promise<ProbeResult>`, `expectedProbe(input): Float32Array`.

- [ ] **Step 1: Write failing pure tests for input bounds and the reference transform `output[i] = input[i] * input[i] + 0.125`.**
- [ ] **Step 2: Run `pnpm vitest run src/gpu/probe-contract.test.ts`; expect missing exports.**
- [ ] **Step 3: Implement strict `32³..64³` grid validation, adapter/device acquisition, storage buffers, WGSL dispatch, error scopes, readback, timing, and Wasm relative-L2 verification at tolerance `5e-6`.**

```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.count) { output[id.x] = input[id.x] * input[id.x] + 0.125; }
}
```

- [ ] **Step 4: Make `ProbeResult.status` equal `verified`, `mismatch`, or `failed`; never return generated output on error.**
- [ ] **Step 5: Run unit tests and `pnpm build`; expect pass and WGSL imported as source.**
- [ ] **Step 6: Commit with `git commit -m "feat(gpu): add verified webgpu compute probe"`.**

### Task 5: Shared 3D result viewer

**Files:**
- Create: `src/viewer/field-instances.ts`, `src/viewer/FieldViewer.tsx`, `src/viewer/field-viewer.css`
- Test: `src/viewer/field-instances.test.ts`, `src/viewer/FieldViewer.test.tsx`

**Interfaces:**
- Consumes: `ProbeResult.output`, grid dimensions, and density threshold.
- Produces: `visibleInstances(field, grid, threshold): InstanceRecord[]`, `FieldViewer` with density and keep-out layers.

- [ ] **Step 1: Write failing tests proving thresholding, stable voxel coordinates, bounded instance counts, and renderer cleanup on unmount.**
- [ ] **Step 2: Run `pnpm vitest run src/viewer`; expect missing exports.**
- [ ] **Step 3: Implement one `InstancedMesh`, orbit controls, resize observer, semantic loading/error overlay, and disposal of renderer, controls, geometry, and material.**
- [ ] **Step 3a: Size the canvas using device-pixel-aware `ResizeObserver`, preserve keyboard-operable DOM controls and a semantic field summary/table outside the canvas, and honor `prefers-reduced-motion`.**
- [ ] **Step 4: Run viewer tests and `pnpm build`; expect pass with no per-voxel mesh allocation.**
- [ ] **Step 5: Commit with `git commit -m "feat(viewer): render computed voxel fields"`.**

### Task 6: State-aware WebMCP and receipts

**Files:**
- Create: `src/webmcp/model-context.d.ts`, `src/webmcp/schemas.ts`, `src/webmcp/executors.ts`, `src/webmcp/register-tools.ts`
- Create: `src/webmcp/FoundationTools.tsx`, `src/app/useProjectState.ts`, `src/app/ReceiptLedger.tsx`
- Create: `src/test/fake-model-context.ts`
- Test: `src/webmcp/register-tools.test.ts`, `src/webmcp/executors.test.ts`

**Interfaces:**
- Consumes: exact snapshots, `runComputeProbe`, and immutable project actions.
- Produces: `foundationToolDefinitions(services)`, lifecycle-bound `FoundationTools`, and executors `inspectDesignContext`, `runFoundationProbe`, `compareFoundationProbes`.

- [ ] **Step 1: Add pinned `use-webmcp-tool@0.2.0`, then write failing tests that verify narrow schemas, Chrome character budgets, read-only/untrusted annotations, shared executor calls, visible receipts, exact revision IDs, and lifecycle-driven unregistration.**
- [ ] **Step 2: Run `pnpm vitest run src/webmcp`; expect missing registration.**
- [ ] **Step 3: Implement three non-overlapping imperative tools through Chrome's lifecycle-managed React hook, with Zod validation, structured errors, surfaced support/registration status, and state-dependent registration. Keep pure definitions/executors separately testable.**
- [ ] **Step 4: Return only revision, capability, timing, verification, and next-action facts; exclude component provenance text from agent instructions.**
- [ ] **Step 5: Run WebMCP tests and `pnpm build`; expect pass.**
- [ ] **Step 6: Commit with `git commit -m "feat(webmcp): expose verified foundation tools"`.**

### Task 7: Judge-mode foundation journey and acceptance gate

**Files:**
- Modify: `src/app/App.tsx`, `src/app/app.css`
- Create: `src/app/FoundationJourney.tsx`, `src/app/EvidencePanel.tsx`, `docs/testing/foundation-gate.md`, `docs/testing/webmcp-foundation-evals.json`
- Test: `src/app/FoundationJourney.test.tsx`

**Interfaces:**
- Consumes: capability detection, fixture, viewer, project state, receipts, and tool registration.
- Produces: one-click `Run foundation probe` journey and an evidence panel that distinguishes verified compute from the future structural optimizer.

- [ ] **Step 1: Write a failing journey test for capability state, exact fixture summary, probe execution, rendered result, receipt, and explicit “compute foundation—not structural optimization” copy.**
- [ ] **Step 2: Run `pnpm vitest run src/app/FoundationJourney.test.tsx`; expect failure.**
- [ ] **Step 3: Implement the journey and fixed test procedure covering UI invocation, WebMCP discovery, direct and ambiguous prompts, negative tool selection, ordered agent chaining, mid-chain failure, unsupported WebGPU/WebMCP, mismatch, cancellation, keyboard use, responsive layout, and reduced motion.**
- [ ] **Step 4: Run `pnpm check`; expect all unit, Rust, Wasm, type, and production-build gates to pass.**
- [ ] **Step 5: Start `pnpm dev --host 127.0.0.1`, open it in the real in-app browser, then verify the Available Tools list and manual success/error/cancel invocations in Chrome's WebMCP DevTools pane. Run the official WebMCP eval smoke mode against `docs/testing/webmcp-foundation-evals.json`; run probabilistic selection evals when a configured backend is available. Record measured WebGPU/WebMCP/eval outcomes; do not call the gate passed if either API is unavailable.**
- [ ] **Step 6: Commit with `git commit -m "feat(app): complete foundation validation journey"`.**

## Completion boundary

This plan does not implement FEM, SIMP, density filtering, optimization, post-extraction re-analysis, STL export, inventory editing, or the final submission presentation. It establishes reusable contracts and proves the deployed-browser compute/tooling path. The next plan may begin only if WebGPU and WebMCP both pass in the actual in-app browser and the probe agrees with the Wasm oracle.
