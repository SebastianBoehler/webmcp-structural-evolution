# Mechanism Dynamics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded rigid-body mechanism solver for exact assemblies, including joints, limits, collision, clearance, forces, and deterministic replay.

**Architecture:** Compile immutable assembly revisions into a worker-owned Rapier world. The mechanism adapter emits revision-keyed motion/contact artifacts through the shared job runner and never writes transforms back into design intent unless the user requests a separate transaction.

**Tech Stack:** TypeScript 7, Zod 4, Vitest 4, Web Workers, `@dimforge/rapier3d-compat@0.20.0`, exact CAD mass/collision artifacts.

**Spec:** `docs/superpowers/specs/2026-08-29-browser-native-cad-platform-design.md`

## Global Constraints

- Complete `2026-08-30-exact-cad-authoring.md` and `2026-08-30-structural-solver-runtime.md` Tasks 1–2 first.
- Pin Rapier to exactly `0.20.0`; do not maintain a second dynamics engine.
- Use fixed `1/240 s` internal steps and stable ID-sorted body, collider, and joint creation.
- Collision approximations record source body revision, tolerance, and approximation kind.
- Scope excludes deformable contact, fluid forces, motors/controllers, and claims of hardware validation.
- Keep every new production file below 300 lines.

---

### Task 1: Mechanism study and replay contracts

**Files:**
- Create: `src/simulation/mechanism-contract.ts`
- Create: `src/simulation/mechanism-replay.ts`
- Modify: `src/engineering/study-schema.ts`
- Test: `src/simulation/mechanism-contract.test.ts`
- Test: `src/simulation/mechanism-replay.test.ts`

**Interfaces:**
- Consumes: `MechanismStudy`, SI transforms, named assembly instances and mates.
- Produces: `MechanismInput`, `MechanismFrame`, `ContactEvent`, `ClearanceSample`, and `MechanismResult` schemas.

- [ ] **Step 1: Write failing validation and replay tests**

```ts
it("rejects a replay with a frame from another revision", () => {
  expect(() => createMechanismReplay({ sourceRevision: "rev-a", frames: [frame("rev-b", 0)] }))
    .toThrow("Mechanism frame revision does not match replay revision");
});
```

Test duplicate timestamps, non-monotonic time, non-normalized quaternions, non-finite forces, unknown body/joint IDs, and contact penetration without a matching contact event.

- [ ] **Step 2: Run tests and confirm missing contracts**

Run: `pnpm vitest run src/simulation/mechanism-contract.test.ts src/simulation/mechanism-replay.test.ts`
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement strict SI contracts**

Support fixed and dynamic bodies; fixed, revolute, prismatic, and rigid joints; lower/upper limits; gravity; point forces; duration; output frequency; collision groups; and clearance query pairs. Normalize quaternions on input and reject a zero quaternion.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run src/simulation/mechanism-contract.test.ts src/simulation/mechanism-replay.test.ts`
Expected: PASS.

```bash
git add src/simulation/mechanism-contract.ts src/simulation/mechanism-contract.test.ts src/simulation/mechanism-replay.ts src/simulation/mechanism-replay.test.ts src/engineering/study-schema.ts
git commit -m "feat(simulation): define mechanism contracts"
```

### Task 2: Assembly-to-mechanism compiler

**Files:**
- Create: `src/simulation/compile-mechanism-study.ts`
- Create: `src/simulation/collision-approximation.ts`
- Test: `src/simulation/compile-mechanism-study.test.ts`
- Test: `src/simulation/collision-approximation.test.ts`

**Interfaces:**
- Consumes: exact CAD mass properties, semantic meshes, assembly instances/mates, `MechanismStudy`.
- Produces: `compileMechanismStudy(document, artifacts, studyId): MechanismInput`.

- [ ] **Step 1: Write failing compiler tests**

Compile a two-link revolute assembly and require body mass/inertia, world transforms, joint anchors/axes/limits, collider provenance, and clearance pairs. Reject unresolved mates, missing mass properties, non-positive inertia, dynamic triangle meshes, stale artifacts, and intersecting initial poses beyond declared tolerance.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run src/simulation/compile-mechanism-study.test.ts src/simulation/collision-approximation.test.ts`
Expected: FAIL because the compiler does not exist.

- [ ] **Step 3: Implement traceable collision approximation**

Use exact primitives where semantic geometry permits; otherwise generate a bounded convex decomposition or convex hull with explicit surface deviation. Triangle meshes are allowed for fixed bodies only. Fail when approximation exceeds the study tolerance.

- [ ] **Step 4: Implement compiler and run tests**

Sort all entities by stable IDs. Convert component-local mates to world anchors using the accepted assembly transform and attach source artifact IDs to every collider.

Run: `pnpm vitest run src/simulation/compile-mechanism-study.test.ts src/simulation/collision-approximation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit compiler**

```bash
git add src/simulation/compile-mechanism-study.ts src/simulation/compile-mechanism-study.test.ts src/simulation/collision-approximation.ts src/simulation/collision-approximation.test.ts
git commit -m "feat(simulation): compile exact assemblies to mechanisms"
```

### Task 3: Worker-owned Rapier solver adapter

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/simulation/rapier-worker-contract.ts`
- Create: `src/simulation/rapier-worker.ts`
- Create: `src/simulation/rapier-worker-client.ts`
- Create: `src/simulation/mechanism-adapter.ts`
- Test: `src/simulation/mechanism-adapter.test.ts`

**Interfaces:**
- Consumes: `MechanismInput`, shared `SolverAdapter` and job events.
- Produces: `createMechanismAdapter(): SolverAdapter<MechanismInput, MechanismResult>`.

- [ ] **Step 1: Write analytical and lifecycle tests**

Require free-fall position within `1%` of `0.5gt²` before contact, a revolute joint to retain its anchor within `1e-5 m`, a prismatic joint to remain inside limits, collision penetration below `1e-4 m` after settling, clearance samples for requested pairs, identical frame bytes on two same-runtime repeats, cancellation, and recovery for the next job.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run src/simulation/mechanism-adapter.test.ts`
Expected: FAIL with missing adapter.

- [ ] **Step 3: Pin Rapier and implement worker protocol**

Run: `pnpm add -E @dimforge/rapier3d-compat@0.20.0`

Initialize Rapier only in the worker. Build the world in ID order, step at `1/240 s`, sample at the requested output rate, and copy frame data into transferable buffers. Emit progress by simulated time. On abort, stop before another step, dispose the world, and emit only `cancelled`.

- [ ] **Step 4: Implement capability and evidence checks**

Bound dynamic bodies, colliders, joints, duration, and output frames. A verified result records integrator step, runtime version, initial/final linear and angular momentum, energy change with gravity/work accounting, maximum joint error, maximum penetration, and minimum requested clearance.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run src/simulation && pnpm build`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/simulation
git commit -m "feat(simulation): solve rigid mechanisms in a worker"
```

### Task 4: Cobot mechanism and browser gate

**Files:**
- Create: `src/samples/cobot/cobot-mechanism-study.ts`
- Create: `src/simulation/browser-mechanism-gate.ts`
- Create: `docs/testing/mechanism-browser-gate.md`
- Test: `src/samples/cobot/cobot-mechanism-study.test.ts`
- Test: `src/simulation/browser-mechanism-gate.test.ts`

**Interfaces:**
- Consumes: the complete cobot assembly, exact CAD artifacts, mechanism adapter, job runner.
- Produces: a recognizable six-axis cobot motion replay and serialized gate report.

- [ ] **Step 1: Write the benchmark test**

Require six revolute joints, declared limits, nonzero link masses/inertias, base fixation, collision pairs, a motion that exercises at least three axes, no self-intersection beyond tolerance, and a cancellation run.

- [ ] **Step 2: Implement the study and automated gate**

Run: `pnpm vitest run src/samples/cobot/cobot-mechanism-study.test.ts src/simulation/browser-mechanism-gate.test.ts && pnpm build && git diff --check`
Expected: PASS.

- [ ] **Step 3: Run the live browser gate**

Run: `pnpm dev --host 127.0.0.1`
Verify the recognizable cobot, joint motion, limits, collision/clearance overlay, pause/cancel/restart, evidence values, and zero console errors. Record actual timings and bounds in `docs/testing/mechanism-browser-gate.md`.

- [ ] **Step 4: Commit measured proof**

```bash
git add src/samples/cobot/cobot-mechanism-study.ts src/samples/cobot/cobot-mechanism-study.test.ts src/simulation/browser-mechanism-gate.ts src/simulation/browser-mechanism-gate.test.ts docs/testing/mechanism-browser-gate.md
git commit -m "test(simulation): prove cobot mechanism workflow"
```
