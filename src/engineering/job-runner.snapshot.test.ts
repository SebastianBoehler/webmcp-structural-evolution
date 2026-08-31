import { describe, expect, it } from "vitest";

import type { EngineeringSolveRequest } from "../cad/engineering-job-contract";
import { createArtifactStore } from "./artifact-store";
import { createEngineeringJobRunner } from "./job-runner";
import { adapter, request, resultFor, sourceDocument } from "./job-runner-test-fixtures";
import { createSolverRegistry } from "./solver-registry";

describe("engineering job launch snapshots", () => {
  it("passes nested private input, settings, and document state to the adapter", async () => {
    const document = await sourceDocument();
    const base = await request(document, "nested-private-snapshot");
    const bytes = new Uint8Array([1, 2]);
    const mutableDocument = structuredClone(document) as unknown as { frames: { label: string }[] };
    const mutable = {
      ...base,
      settings: { nested: { mode: "before" } },
      input: { grid: [8, 4, 2], nested: { bytes } },
      document: mutableDocument,
    } as unknown as EngineeringSolveRequest<unknown>;
    let observed: Record<string, unknown> | undefined;
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => {
      const input = solveRequest.input as unknown as { nested: { bytes: Uint8Array } };
      const settings = solveRequest.settings as unknown as { nested: { mode: string } };
      observed = {
        byte: input.nested.bytes[0], mode: settings.nested.mode, label: solveRequest.document.frames[0]?.label,
      };
      return resultFor(solveRequest);
    }));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const handle = runner.launch(mutable);

    bytes[0] = 9;
    (mutable.settings as { nested: { mode: string } }).nested.mode = "after";
    mutableDocument.frames[0]!.label = "Mutated";

    await expect(handle.completion).resolves.toMatchObject({ event: { state: "verified" } });
    expect(observed).toEqual({ byte: 1, mode: "before", label: "World" });
  });

  it("rejects shared buffers and shared-backed views before reserving any job", async () => {
    const document = await sourceDocument();
    const shared = new SharedArrayBuffer(4);
    let runs = 0;
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => {
      runs += 1;
      return resultFor(solveRequest);
    }));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    let accessorReads = 0;
    const accessorInput = { grid: [8, 4, 2] };
    Object.defineProperty(accessorInput, "shared", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return new Uint8Array(shared);
      },
    });
    const cases = [
      { input: { grid: [8, 4, 2], nested: { direct: shared } } },
      { settings: { nested: { view: new Uint8Array(shared) } } },
      { document: { ...structuredClone(document), nested: { view: new DataView(shared) } } },
      { input: accessorInput },
    ];

    for (let index = 0; index < cases.length; index += 1) {
      const candidate = { ...await request(document, `shared-launch-${index}`), ...cases[index] } as unknown as EngineeringSolveRequest<unknown>;
      let failure: unknown;
      try {
        runner.launch(candidate);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: "invalid-input" });
    }

    expect(runner.entries()).toEqual([]);
    expect(runs).toBe(0);
    expect(accessorReads).toBe(0);
  });
});
