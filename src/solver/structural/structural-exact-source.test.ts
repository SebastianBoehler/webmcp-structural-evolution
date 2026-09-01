import { beforeEach, expect, test, vi } from "vitest";

import { createThermalAnalyticalRequest } from "../thermal/thermal-analytical-request";
import { rebuildStructuralExactSource } from "./structural-exact-source";

const cad = vi.hoisted(() => ({ evaluate: vi.fn(), dispose: vi.fn() }));
vi.mock("../../cad/kernel/occt-adapter", () => ({
  createOcctCadAdapter: () => ({ evaluate: cad.evaluate, dispose: cad.dispose }),
}));

beforeEach(() => vi.clearAllMocks());

test("disposes the owned OCCT adapter after a successful exact rebuild", async () => {
  const source = await createThermalAnalyticalRequest({ dimensions: [1, 1, 1], cellSizeM: 1,
    bodies: [{ id: "bar", materialId: "metal", conductivityWmK: 1 }],
    cellBodyIndices: new Uint32Array(1), boundaries: [
      { id: "fixed", cellIndex: 0, axis: 0, direction: -1, areaM2: 1, temperatureK: 300 },
    ] });
  cad.evaluate.mockImplementation(async (request, _signal, emit) => emit({ state: "succeeded",
    requestId: request.requestId, sourceRevision: request.sourceRevision, results: [
      { output: "brep", artifact: source.inputArtifacts[0], payload: { bytes: Uint8Array.of(1) } },
      { output: "semantic-mesh", artifact: source.inputArtifacts[1],
        payload: source.input.semanticMeshPayload },
    ] }));

  await expect(rebuildStructuralExactSource(source.document, new AbortController().signal))
    .resolves.toMatchObject({ semanticArtifact: source.inputArtifacts[1] });
  expect(cad.dispose).toHaveBeenCalledOnce();
});

test("disposes the owned OCCT adapter when evaluation rejects", async () => {
  const source = await createThermalAnalyticalRequest({ dimensions: [1, 1, 1], cellSizeM: 1,
    bodies: [{ id: "bar", materialId: "metal", conductivityWmK: 1 }],
    cellBodyIndices: new Uint32Array(1), boundaries: [
      { id: "fixed", cellIndex: 0, axis: 0, direction: -1, areaM2: 1, temperatureK: 300 },
    ] });
  cad.evaluate.mockRejectedValue(new Error("worker failed"));

  await expect(rebuildStructuralExactSource(source.document, new AbortController().signal))
    .rejects.toThrow("worker failed");
  expect(cad.dispose).toHaveBeenCalledOnce();
});

test("disposes the owned OCCT adapter when evaluation observes abort", async () => {
  const source = await createThermalAnalyticalRequest({ dimensions: [1, 1, 1], cellSizeM: 1,
    bodies: [{ id: "bar", materialId: "metal", conductivityWmK: 1 }],
    cellBodyIndices: new Uint32Array(1), boundaries: [
      { id: "fixed", cellIndex: 0, axis: 0, direction: -1, areaM2: 1, temperatureK: 300 },
    ] });
  const controller = new AbortController();
  controller.abort(new DOMException("stop exact rebuild", "AbortError"));
  cad.evaluate.mockImplementation(async (_request, signal) => signal.throwIfAborted());

  await expect(rebuildStructuralExactSource(source.document, controller.signal))
    .rejects.toThrow("stop exact rebuild");
  expect(cad.dispose).toHaveBeenCalledOnce();
});
