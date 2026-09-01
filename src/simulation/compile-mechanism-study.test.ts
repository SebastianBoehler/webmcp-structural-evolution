import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CadEvaluationEvent, CadEvaluationRequest } from "../cad/runtime-contracts";
import { defineDesignDocument } from "../cad/document-schema";
import { createArtifactIndex } from "../cad/artifact-contract";
import { defineMechanismInput } from "./mechanism-contract";
import { exactCompilerSuccess, mechanismDocument, unitBoxBrep } from "./compile-mechanism-study.test-support";

const worker = vi.hoisted(() => ({
  evaluateMechanismExactRequest: vi.fn(),
  checkExactInitialOverlaps: vi.fn(),
}));
vi.mock("./mechanism-exact-worker", () => worker);
vi.mock("./mechanism-overlap", () => ({ checkExactInitialOverlaps: worker.checkExactInitialOverlaps }));

import { assertCompiledMechanismStudy, compileMechanismStudy } from "./compile-mechanism-study";

let brepBytes: Uint8Array;
beforeAll(async () => { brepBytes = await unitBoxBrep(); });
beforeEach(() => {
  worker.evaluateMechanismExactRequest.mockReset();
  worker.checkExactInitialOverlaps.mockReset();
  worker.checkExactInitialOverlaps.mockResolvedValue(undefined);
  worker.evaluateMechanismExactRequest.mockImplementation(async (
    request: CadEvaluationRequest, _signal: AbortSignal, emit: (event: CadEvaluationEvent) => void,
  ) => emit(await exactCompilerSuccess(request, brepBytes)));
});

describe("assembly-to-mechanism compiler", () => {
  it("compiles exact two-link intent with rotated dual axes, material inertia, and provenance", async () => {
    const document = await mechanismDocument();
    const compiled = await compileMechanismStudy(document, "motion", new AbortController().signal);
    expect(compiled.input.truthLevel).toBe("unverified-mechanism-input");
    expect(compiled.input.bodies.map(({ id }) => id)).toEqual(["base", "link"]);
    const link = compiled.input.bodies[1]!;
    if (link.kind !== "dynamic") throw new Error("expected dynamic link");
    expect(link.massKg).toBeCloseTo(2, 12);
    expect(link.centerOfMassM).toEqual([0, 0, 0.5]);
    expect(link.transform.orientation[2]).toBeCloseTo(Math.SQRT1_2, 14);
    const joint = compiled.input.joints[0]!;
    if (joint.kind !== "revolute") throw new Error("expected revolute joint");
    expect(joint).toMatchObject({
      firstAnchorLocalM: [0, 0, 0.5], secondAnchorLocalM: [0, 0, 0.5],
      firstAxisLocal: [1, 0, 0], lowerRad: -1, upperRad: 1,
    });
    expect(joint.secondAxisLocal[0]).toBeCloseTo(0, 14);
    expect(joint.secondAxisLocal[1]).toBeCloseTo(-1, 14);
    expect(compiled.input.colliders).toHaveLength(2);
    expect(compiled.input.colliders.every(({ sourceArtifactIds }) => sourceArtifactIds.length === 2)).toBe(true);
    expect(compiled.input.clearancePairs[0]).toMatchObject({ sourceQueryId: "base-link-query" });
    expect(worker.checkExactInitialOverlaps).toHaveBeenCalledOnce();
    expect(compiled.sourceArtifacts).toHaveLength(2);
    expect(createArtifactIndex(document.revision, compiled.sourceArtifacts).artifacts).toHaveLength(2);
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.input.bodies)).toBe(true);
    const reparsed = await defineMechanismInput(structuredClone(compiled.input));
    expect(reparsed.mechanismInputDigest).toBe(compiled.input.mechanismInputDigest);
  });

  it.each(["rigid", "prismatic"] as const)("constructs a %s joint", async (kind) => {
    const compiled = await compileMechanismStudy(await mechanismDocument(kind), "motion", new AbortController().signal);
    expect(compiled.input.joints[0]?.kind).toBe(kind);
    if (kind === "prismatic") expect(compiled.input.joints[0]).toMatchObject({ lowerM: -0.2, upperM: 0.3 });
  });

  it("accepts rigid mates on resolved non-axial exact faces", async () => {
    const original = await mechanismDocument("rigid");
    const polygon = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
    const { revision: _revision, ...content } = original;
    const document = await defineDesignDocument({ ...content,
      sketches: content.sketches.map((sketch) => ({ ...sketch,
        entities: polygon.map((startM, index) => ({ id: `${sketch.id}-edge-${index}`, kind: "line" as const,
          startM, endM: polygon[(index + 1) % polygon.length]! })),
      })),
      namedSelections: content.namedSelections.map((selection) => ({ ...selection,
        reference: { ...selection.reference,
          signature: { ...selection.reference.signature, geometry: "sphere" as const } },
      })),
    });
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: (event: CadEvaluationEvent) => void,
    ) => emit(await exactCompilerSuccess(request, brepBytes, [0, 0, 0.5], [0, -1, 0], "sphere")));
    const compiled = await compileMechanismStudy(document, "motion", new AbortController().signal);
    expect(compiled.input.joints[0]).toMatchObject({ kind: "rigid",
      firstAnchorLocalM: [0, 0, 0.5], secondAnchorLocalM: [0, 0, 0.5] });
  });

  it("normalizes extreme finite design axes only at the compiler boundary", async () => {
    const original = await mechanismDocument();
    const { revision: _revision, ...content } = original;
    const document = await defineDesignDocument({ ...content, mates: content.mates.map((mate) => mate.kind === "revolute"
      ? { ...mate, axisFirstLocal: [Number.MAX_VALUE, Number.MIN_VALUE, 0] }
      : mate) });
    const compiled = await compileMechanismStudy(document, "motion", new AbortController().signal);
    const joint = compiled.input.joints[0];
    if (!joint || joint.kind === "rigid") throw new Error("expected axial joint");
    expect(joint.firstAxisLocal).toEqual([1, 0, 0]);
  });

  it("combines multiple component bodies and expands one clearance query over every collider pair", async () => {
    const original = await mechanismDocument();
    const { revision: _revision, ...content } = original;
    const document = await defineDesignDocument({
      ...content,
      sketches: [...content.sketches, {
        id: "link-second-sketch", plane: "frame:world", constraints: [],
        entities: [{ id: "link-second-outline", kind: "rectangle", centerM: [2, 0], sizeM: [1, 1] }],
      }],
      features: [...content.features, { id: "link-second-feature", kind: "extrude", sketchId: "link-second-sketch", distanceM: 1 }],
      bodies: [...content.bodies, { id: "link-second-body", featureId: "link-second-feature" }],
      components: content.components.map((component) => component.id === "link-component"
        ? { ...component, bodyIds: [...component.bodyIds, "link-second-body"] }
        : component),
    });
    const compiled = await compileMechanismStudy(document, "motion", new AbortController().signal);
    const link = compiled.input.bodies.find(({ id }) => id === "link")!;
    if (link.kind !== "dynamic") throw new Error("expected dynamic link");
    expect(link.massKg).toBeCloseTo(4, 12);
    expect(link.centerOfMassM).toEqual([1, 0, 0.5]);
    expect(link.principalInertiaKgM2[0]).toBeCloseTo(2 / 3, 12);
    expect(link.principalInertiaKgM2[1]).toBeCloseTo(14 / 3, 12);
    expect(compiled.input.colliders.filter(({ bodyId }) => bodyId === "link")).toHaveLength(2);
    expect(compiled.input.clearancePairs).toHaveLength(2);
    expect(compiled.input.clearancePairs.every(({ sourceQueryId }) => sourceQueryId === "base-link-query")).toBe(true);
  });

  it("routes proven convex dynamic geometry to a hull and rejects concave dynamic geometry", async () => {
    const original = await mechanismDocument();
    const polygon = (concave: boolean): [number, number][] => [
      [0, 0], [1, 0], ...(concave ? [[0.4, 0.4] as [number, number]] : []), [1, 1], [0, 1],
    ];
    const replaceLink = async (points: [number, number][]) => {
      const { revision: _revision, ...content } = original;
      return defineDesignDocument({ ...content, sketches: content.sketches.map((sketch) => sketch.id !== "link-sketch" ? sketch : {
        ...sketch, entities: points.map((startM, index) => ({ id: `link-edge-${index}`, kind: "line",
          startM, endM: points[(index + 1) % points.length]! })),
      }) });
    };
    const convex = await compileMechanismStudy(await replaceLink(polygon(false)), "motion", new AbortController().signal);
    expect(convex.input.colliders.find(({ bodyId }) => bodyId === "link")?.shape.kind).toBe("convex-hull");
    await expect(compileMechanismStudy(
      await replaceLink(polygon(true)), "motion", new AbortController().signal,
    )).rejects.toThrow(/unsupported dynamic collision geometry/i);
  });

  it("rejects exact semantic mate faces whose accepted world anchors do not coincide", async () => {
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: (event: CadEvaluationEvent) => void,
    ) => emit(await exactCompilerSuccess(request, brepBytes, [0.01, 0, 0.5])));
    await expect(compileMechanismStudy(
      await mechanismDocument(), "motion", new AbortController().signal,
    )).rejects.toThrow(/anchors do not coincide/i);
  });

  it("rejects an intent axis that is not parallel to both exact selected face axes", async () => {
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: (event: CadEvaluationEvent) => void,
    ) => emit(await exactCompilerSuccess(request, brepBytes, [0, 0, 0.5], [1, 0, 0])));
    await expect(compileMechanismStudy(
      await mechanismDocument(), "motion", new AbortController().signal,
    )).rejects.toThrow(/intent axis does not match exact face geometry/i);
  });

  it("rejects unconfigured intent and cancellation before exact rebuild", async () => {
    await expect(compileMechanismStudy(
      await mechanismDocument("revolute", "requires-configuration"), "motion", new AbortController().signal,
    )).rejects.toThrow(/requires configuration/i);
    const controller = new AbortController();
    controller.abort();
    await expect(compileMechanismStudy(await mechanismDocument(), "motion", controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("is invariant to exact result ordering and exposes no raw authority helper", async () => {
    const document = await mechanismDocument();
    const first = await compileMechanismStudy(document, "motion", new AbortController().signal);
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: (event: CadEvaluationEvent) => void,
    ) => {
      const success = await exactCompilerSuccess(request, brepBytes);
      emit({ ...success, results: [...success.results].reverse() });
    });
    const second = await compileMechanismStudy(document, "motion", new AbortController().signal);
    expect(second.input.mechanismInputDigest).toBe(first.input.mechanismInputDigest);
    expect(Object.keys(await import("./compile-mechanism-study"))).toEqual([
      "assertCompiledMechanismStudy", "compileMechanismStudy",
    ]);
  });

  it("brands only the in-process exact compiler result for the solver adapter boundary", async () => {
    const compiled = await compileMechanismStudy(await mechanismDocument(), "motion", new AbortController().signal);
    expect(assertCompiledMechanismStudy(compiled)).toBe(compiled);
    expect(() => assertCompiledMechanismStudy(Object.freeze({
      input: compiled.input, sourceArtifacts: compiled.sourceArtifacts,
    }))).toThrow(/exact compiler authority/i);
    expect(() => assertCompiledMechanismStudy(structuredClone(compiled)))
      .toThrow(/exact compiler authority/i);
  });

  it("rejects caller authority fields and incomplete same-request exact outputs", async () => {
    const document = await mechanismDocument();
    await expect(compileMechanismStudy(
      { ...document, artifacts: [] } as never, "motion", new AbortController().signal,
    )).rejects.toThrow(/unrecognized/i);
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: (event: CadEvaluationEvent) => void,
    ) => {
      const success = await exactCompilerSuccess(request, brepBytes);
      emit({ ...success, results: success.results.filter(({ output }) => output !== "body-dynamics") });
    });
    await expect(compileMechanismStudy(document, "motion", new AbortController().signal))
      .rejects.toThrow(/required exact output|payload/i);
  });

  it("canonicalizes undirected clearance collider endpoints before hashing", async () => {
    const original = await mechanismDocument();
    const { revision: _revision, ...content } = original;
    const reversed = await defineDesignDocument({ ...content, studies: content.studies.map((study) =>
      study.kind === "mechanism" && study.configurationState === "configured"
        ? { ...study, clearancePairs: study.clearancePairs.map((query) => ({
          ...query, firstInstanceId: query.secondInstanceId, secondInstanceId: query.firstInstanceId,
        })) }
        : study) });
    const first = await compileMechanismStudy(original, "motion", new AbortController().signal);
    const second = await compileMechanismStudy(reversed, "motion", new AbortController().signal);
    expect(second.input.clearancePairs).toEqual(first.input.clearancePairs);
  });
});
