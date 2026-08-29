# Design Document Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the immutable `DesignDocument` v1, atomic typed transactions, revision history, derived-artifact invalidation, and CAD/job adapter contracts that every later CAD, physics, manufacturing, UI, and WebMCP increment consumes.

**Architecture:** Add a dependency-free `src/cad` domain package beside the existing fixture-oriented models. Documents normalize engineering values before SHA-256 revisioning; transactions produce new documents and changed semantic references; history and artifact indexes remain immutable; runtime contracts describe CAD and solver work without shipping a fake kernel or solver.

**Tech Stack:** TypeScript 7, Zod 4, Web Crypto SHA-256, Vitest 4, existing engineering-unit/snapshot/receipt utilities.

**Spec:** `docs/superpowers/specs/2026-08-29-browser-native-cad-platform-design.md`

## Global Constraints

- Browser-runnable means WebGPU plus multithreaded Wasm and optional remote workers; it does not require every algorithm to be a WebGPU shader.
- `DesignDocument` is the only authoritative design-intent state; render meshes, solver grids, and toolpaths are derived artifacts.
- Commands reject stale parent revisions and apply atomically; no renderer object or fixture ID enters the document.
- Normalize physical values before revision hashing and preserve explicit display units separately.
- Do not add dependencies, mock kernels, mock solvers, UI controls, fixture migration, or unsupported CAD feature commands in this increment.
- Keep each production file below the repository's 300-line soft limit and use focused files with one responsibility.
- Node `24.19.0`, pnpm `10.15.0`, and existing `pnpm check` remain the verification baseline.

## File map

- `src/cad/document-schema.ts`, `command-schema.ts`, and `transactions.ts`: normalized immutable documents and atomic typed edits.
- `src/cad/artifact-contract.ts` and `artifact-invalidation.ts`: deterministic derived artifacts and transitive invalidation.
- `src/cad/design-history.ts`: revision graph, branching, checkout, undo target, and acceptance.
- `src/cad/runtime-contracts.ts`: CAD evaluation and general engineering-job messages.
- `src/cad/design-session.ts` and `index.ts`: orchestration and intentional public exports for later consumers.

---

### Task 1: Immutable normalized `DesignDocument` v1

**Files:** Create `src/cad/document-schema.ts`; test `src/cad/document-schema.test.ts`.

**Interfaces:** Consumes existing engineering-unit schemas/normalizers, `defineRevisionedSnapshot`, and `DeepReadonly`; produces `EntityIdSchema`, `SemanticReferenceSchema`, `ParameterValueSchema`, `DesignDocumentContentSchema`, `DesignDocumentSchema`, `DesignDocument`, `defineDesignDocument(value)`, and `createDesignDocument(input)`.

- [ ] **Step 1: Write failing schema, normalization, and immutability tests**

```ts
const metric = await createDesignDocument({ id: "pump", label: "Pump", units: { length: "mm", angle: "deg", mass: "kg" }, createdBy: { kind: "human", id: "sebastian" } });
const withoutRevision = ({ revision: _revision, ...content }: DesignDocument) => content;
const mmDocument = await defineDesignDocument({ ...withoutRevision(metric), parameters: [{ id: "shaft-length", label: "Shaft length", value: { kind: "length", value: { value: 1000, unit: "mm" } } }] });
const mDocument = await defineDesignDocument({ ...withoutRevision(metric), parameters: [{ id: "shaft-length", label: "Shaft length", value: { kind: "length", value: { value: 1, unit: "m" } } }] });
expect(mmDocument.revision).toBe(mDocument.revision);
expect(mmDocument.parameters[0]!.value).toEqual({ kind: "length", value: { value: 1, unit: "m" } });
expect(Object.isFrozen(mmDocument.parameters)).toBe(true);
await expect(defineDesignDocument({ ...withoutRevision(metric), frames: [metric.frames[0], metric.frames[0]] })).rejects.toThrow(/duplicate frame/i);
```

- [ ] **Step 2: Run the test and verify the new module is absent**

Run: `pnpm test:run src/cad/document-schema.test.ts`  
Expected: FAIL because `./document-schema` cannot be resolved.

- [ ] **Step 3: Implement the minimal schema and constructors**

Use lowercase kebab-case entity IDs (`/^[a-z][a-z0-9-]{0,79}$/`). Define parameter values only for `dimensionless`, `length`, `angle`, `mass`, `boolean`, and `text`. `createDesignDocument` must create one `world` frame with a zero SI transform, empty parameters, `schemaVersion: 1`, and explicit display units. `defineDesignDocument` must normalize all frame transforms and physical parameter values before calling `defineRevisionedSnapshot`; `DesignDocumentSchema` parses the resulting content plus required revision.

Add `superRefine` checks for unique frame/parameter IDs, exactly one root frame named `world`, resolved parents, and acyclic frame parents. Export semantic references as strings matching `^(document|parameter|frame):[a-z][a-z0-9-]{0,79}$`.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test:run src/cad/document-schema.test.ts src/domain/revisions.test.ts src/domain/design.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit the document contract**

```bash
git add src/cad/document-schema.ts src/cad/document-schema.test.ts
git commit -m "feat(cad): add revisioned design document"
```

### Task 2: Atomic typed design transactions

**Files:** Create `src/cad/command-schema.ts` and `src/cad/transactions.ts`; test `src/cad/transactions.test.ts`.

**Interfaces:** Consumes the document, parameter/frame, and revision contracts; produces `DesignCommand`, `DesignPrecondition`, `DesignTransaction`, `ChangedReference`, `TransactionDiagnostic`, `DesignTransactionResult`, and `applyDesignTransaction(document, input)`.

- [ ] **Step 1: Write failing atomicity and concurrency tests**

```ts
const stale = await applyDesignTransaction(document, { id: "tx-stale", expectedRevision: "0".repeat(64), actor: human, preconditions: [], commands: [defineLength] });
expect(stale).toMatchObject({ ok: false, code: "stale-revision" });

const failed = await applyDesignTransaction(document, { id: "tx-atomic", expectedRevision: document.revision, actor: human, preconditions: [], commands: [defineLength, defineLength] });
expect(failed).toMatchObject({ ok: false, code: "command-failed" });
expect(document.parameters).toHaveLength(0);

const success = await applyDesignTransaction(document, transaction);
expect(success).toMatchObject({ ok: true, changedReferences: ["parameter:shaft-length"] });
if (success.ok) expect(success.document.revision).not.toBe(document.revision);
```

- [ ] **Step 2: Run the test and verify the transaction modules are absent**

Run: `pnpm test:run src/cad/transactions.test.ts`  
Expected: FAIL resolving `./transactions`.

- [ ] **Step 3: Implement schemas and an atomic reducer**

Support exactly these commands: `rename-document`, `define-parameter`, `set-parameter`, `remove-parameter`, and `define-frame`. Support `parameter-equals` and `reference-exists` preconditions. Limit transactions to 64 commands and require unique command IDs.

`applyDesignTransaction` parses unknown input, checks `expectedRevision`, evaluates every precondition against the original document, applies commands to mutable local copies, and calls `defineDesignDocument` only after every command succeeds. Return one of these codes without throwing: `invalid-transaction`, `stale-revision`, `precondition-failed`, or `command-failed`. Successful changed references are unique and lexicographically sorted; setting an existing value is a successful no-op with the original revision and no changed references.

- [ ] **Step 4: Run transaction and canonical-revision tests**

Run: `pnpm test:run src/cad/transactions.test.ts src/cad/document-schema.test.ts src/domain/revisions.test.ts`  
Expected: PASS, including equivalent physical-unit transactions producing the same document revision.

- [ ] **Step 5: Commit the transaction boundary**

```bash
git add src/cad/command-schema.ts src/cad/transactions.ts src/cad/transactions.test.ts
git commit -m "feat(cad): add atomic design transactions"
```

### Task 3: Revision-keyed artifact graph and invalidation

**Files:** Create `src/cad/artifact-contract.ts` and `src/cad/artifact-invalidation.ts`; test `src/cad/artifact-invalidation.test.ts`.

**Interfaces:** Consumes revision/reference schemas and snapshot utilities; produces `ArtifactKind`, `ArtifactRecordSchema`, `ArtifactRecord`, `ArtifactIndex`, `defineArtifactRecord(value)`, `createArtifactIndex(documentRevision, artifacts)`, and `invalidateArtifacts(index, changedReferences, nextRevision)`.

- [ ] **Step 1: Write failing deterministic and transitive invalidation tests**

```ts
const brep = await defineArtifactRecord(record("brep", [entity("parameter:shaft-length")]));
const mesh = await defineArtifactRecord(record("render-mesh", [artifact(brep.id)]));
const thumbnail = await defineArtifactRecord(record("thumbnail", [artifact(mesh.id)]));
const index = createArtifactIndex(document.revision, [thumbnail, mesh, brep]);
const result = invalidateArtifacts(index, ["parameter:shaft-length"], nextRevision);
expect(result.invalidatedIds).toEqual([brep.id, mesh.id, thumbnail.id].sort());
expect(result.index).toEqual({ documentRevision: nextRevision, artifacts: [] });
expect((await defineArtifactRecord({ ...withoutId(brep) })).id).toBe(brep.id);
```

- [ ] **Step 2: Run the test and verify the artifact modules are absent**

Run: `pnpm test:run src/cad/artifact-invalidation.test.ts`  
Expected: FAIL resolving the new modules.

- [ ] **Step 3: Implement artifact identities and invalidation**

Use artifact kinds `brep`, `render-mesh`, `collision-mesh`, `sdf`, `solver-mesh`, `field`, `manufacturing-mesh`, `toolpath`, `thumbnail`, and `export`. Derive `ArtifactRecord.id` from canonical content containing kind, source revision, producer name/version, settings digest, content digest, units, media type, and sorted dependencies. Reject a claimed mismatched ID.

`invalidateArtifacts` first marks artifacts with an entity dependency in `changedReferences`, then repeatedly marks consumers through artifact dependencies until stable. Retain unaffected artifacts, update the index document revision, and return sorted invalidated IDs. Retained records keep their original source revision because an artifact unaffected by the edit is reusable on a descendant revision; reject only duplicate IDs and dangling artifact dependencies.

- [ ] **Step 4: Run artifact and transaction tests**

Run: `pnpm test:run src/cad/artifact-invalidation.test.ts src/cad/transactions.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit the artifact graph**

```bash
git add src/cad/artifact-contract.ts src/cad/artifact-invalidation.ts src/cad/artifact-invalidation.test.ts
git commit -m "feat(cad): track derived artifact invalidation"
```

### Task 4: Branchable document history

**Files:** Create `src/cad/design-history.ts`; test `src/cad/design-history.test.ts`.

**Interfaces:** Consumes successful transaction results, documents, and snapshot freezing; produces the revision/history types plus creation, commit, checkout, acceptance, parent, and child-navigation functions.

- [ ] **Step 1: Write failing branch, checkout, and acceptance tests**

```ts
const history0 = createDesignHistory(root);
const historyA = commitDesignRevision(history0, root.revision, "tx-a", branchA);
const historyAB = commitDesignRevision(historyA, root.revision, "tx-b", branchB);
expect(childRevisions(historyAB, root.revision)).toEqual([branchA.revision, branchB.revision].sort());
expect(checkoutDesignRevision(historyAB, branchA.revision).headRevision).toBe(branchA.revision);
expect(parentRevision(historyAB, branchA.revision)).toBe(root.revision);
expect(acceptDesignRevision(historyAB, branchB.revision).acceptedRevision).toBe(branchB.revision);
expect(() => acceptDesignRevision(historyAB, "f".repeat(64))).toThrow(/unknown revision/i);
```

- [ ] **Step 2: Run the test and verify the history module is absent**

Run: `pnpm test:run src/cad/design-history.test.ts`  
Expected: FAIL resolving `./design-history`.

- [ ] **Step 3: Implement immutable revision storage and navigation**

Store documents and nodes in frozen records keyed by revision. The root node has `parentRevision: null` and `transactionId: null`. Committing requires a known parent and a new document revision; the new revision becomes head without changing accepted revision. Checkout changes only head. Acceptance requires a known revision. Return children sorted by revision so branch behavior is deterministic. Session orchestration must not call commit for a successful no-op transaction.

- [ ] **Step 4: Run history and revision tests**

Run: `pnpm test:run src/cad/design-history.test.ts src/cad/transactions.test.ts src/domain/revisions.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit history support**

```bash
git add src/cad/design-history.ts src/cad/design-history.test.ts
git commit -m "feat(cad): add branchable design history"
```

### Task 5: CAD and engineering-job runtime contracts

**Files:** Create `src/cad/runtime-contracts.ts`; test `src/cad/runtime-contracts.test.ts`.

**Interfaces:** Consumes document, revision, artifact, and JSON-value schemas; produces CAD evaluation requests/events/adapters and engineering job requests/events/truth levels.

- [ ] **Step 1: Write failing serialization and truth-boundary tests**

```ts
expect(CadEvaluationRequestSchema.parse(request)).toEqual(request);
expect(() => CadEvaluationRequestSchema.parse({ ...request, requestedOutputs: ["fake-solid"] })).toThrow();
expect(EngineeringJobEventSchema.parse({ jobId: "job-1", state: "partial", progress: 0.5, artifacts: [] })).toMatchObject({ state: "partial" });
expect(() => EngineeringJobEventSchema.parse({ jobId: "job-1", state: "partial", truthLevel: "converged-numerical-solve", progress: 0.5, artifacts: [] })).toThrow();
expect(canonicalJson(EngineeringJobRequestSchema.parse(job))).toContain('"sourceRevision"');
```

- [ ] **Step 2: Run the test and verify the runtime contract is absent**

Run: `pnpm test:run src/cad/runtime-contracts.test.ts`  
Expected: FAIL resolving `./runtime-contracts`.

- [ ] **Step 3: Implement cloneable schemas and the adapter interface**

CAD outputs are limited to `brep`, `semantic-mesh`, `mass-properties`, `section-curves`, and `step`. CAD events are `progress`, `succeeded`, `failed`, or `cancelled`; failures contain codes `invalid-document`, `feature-failed`, `invalid-solid`, `reference-requires-repair`, `resource-limit`, or `internal-error`.

Engineering job kinds are `cad-rebuild`, `collision`, `mechanism`, `topology`, `fea`, `cfd`, `thermal`, `additive`, `slicing`, and `export`. Job states match the spec: `queued`, `running`, `partial`, `verified`, `failed`, and `cancelled`. Only `verified` accepts a truth level. Define `CadKernelAdapter.evaluate(request, signal, emit): Promise<void>`; do not provide a production implementation.

- [ ] **Step 4: Run runtime and canonical-JSON tests**

Run: `pnpm test:run src/cad/runtime-contracts.test.ts src/domain/revisions.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit runtime contracts**

```bash
git add src/cad/runtime-contracts.ts src/cad/runtime-contracts.test.ts
git commit -m "feat(cad): define kernel and job contracts"
```

### Task 6: Design session orchestration and public API

**Files:** Create `src/cad/design-session.ts` and `src/cad/index.ts`; test `src/cad/design-session.test.ts` and `src/cad/public-api.test.ts`.

**Interfaces:** Consumes transactions, history, artifact invalidation, and action receipts; produces `DesignSession`, `DesignSessionClock`, session creation/application/inspection functions, and the stable `src/cad/index.ts` surface.

- [ ] **Step 1: Write failing session and public-surface tests**

```ts
const applied = await applyDesignSessionTransaction(session, transaction, { now: () => "2026-08-29T12:00:00.000Z", elapsedMs: () => 3 });
expect(applied.result.ok).toBe(true);
expect(applied.session.history.headRevision).toBe(applied.result.ok ? applied.result.document.revision : "");
expect(applied.session.artifacts.invalidatedIds).toContain(brep.id);
expect(applied.session.receipts.at(-1)).toMatchObject({ action: "apply_design_transaction", outcome: { status: "succeeded" }, duration: { value: 3, unit: "ms" } });
expect(inspectDesignSession(applied.session)).toMatchObject({ parameterCount: 1, branchCount: 1, invalidatedArtifactCount: 1 });
expect(Object.keys(await import("./index"))).toEqual(expect.arrayContaining(["createDesignDocument", "applyDesignTransaction", "createDesignSession"]));
```

- [ ] **Step 2: Run tests and verify the session/public modules are absent**

Run: `pnpm test:run src/cad/design-session.test.ts src/cad/public-api.test.ts`  
Expected: FAIL resolving the new modules.

- [ ] **Step 3: Implement orchestration without UI or fixture coupling**

`DesignSession` owns history, `artifacts: { index: ArtifactIndex; invalidatedIds: readonly string[] }`, and action receipts. A changed successful transaction commits its document under the transaction's expected revision, invalidates artifacts, and appends a succeeded receipt. A successful no-op appends its receipt without adding history or invalidation. A failed transaction preserves history/artifacts and appends a failed receipt. `inspectDesignSession` reports IDs, counts, units, head/accepted revisions, leaf-branch count, and invalidation count without exposing mutable internals.

Export only documented schemas, types, constructors, transaction/history/artifact functions, runtime contracts, and session functions from `src/cad/index.ts`.

- [ ] **Step 4: Run the complete CAD foundation and project verification**

Run: `pnpm test:run src/cad && pnpm check`  
Expected: all CAD tests, the complete Vitest suite, TypeScript/Vite build, Wasm build, and Rust tests pass. Existing Node-version, OCCT browser-externalization, Cargo metadata, and bundle-size warnings may remain; no new warning is accepted.

- [ ] **Step 5: Perform the live browser regression gate**

Run `pnpm dev --host 127.0.0.1 --port 4173`, open the local app in the in-app browser, select both `Reference FPV drone` and `SE-6 six-axis cobot`, inspect each document context through the existing WebMCP tool, and generate one SE-6 topology candidate. Expected: both assemblies render, the candidate verifies, the browser console is clean after a fresh reload, and no new CAD feature is advertised because no exact kernel exists yet.

- [ ] **Step 6: Commit the integrated foundation**

```bash
git add src/cad/design-session.ts src/cad/design-session.test.ts src/cad/index.ts src/cad/public-api.test.ts
git commit -m "feat(cad): expose design document foundation"
```

## Completion gate

- Every production file is below 300 lines and `git diff --check` is clean.
- Equivalent SI inputs produce identical document revisions and artifact identities.
- Transactions are atomic, stale-safe, and return typed failures without mutating the input document.
- Branches, checkout, parent navigation, and acceptance are deterministic.
- Artifact invalidation is transitive and preserves unaffected artifacts.
- CAD/job contracts serialize through canonical JSON and do not claim unsupported truth levels.
- The public API has no fixture, renderer, React, solver implementation, or OCCT dependency.
- The existing production workflows remain visually and functionally unchanged.
