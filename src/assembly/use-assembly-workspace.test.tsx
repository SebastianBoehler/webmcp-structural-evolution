import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";

import { defineComponent } from "../domain/component-model";
import { defineAssemblyDraft, defineInventory } from "../domain/design";
import { referenceComponent } from "../samples/reference-drone-catalog";
import { createAssemblyAuthoringState } from "./assembly-authoring";
import { useAssemblyWorkspace } from "./use-assembly-workspace";

const m = (value: number) => ({ value, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });

async function workspaceFixture() {
  const source = referenceComponent("body-interface");
  const { revision: _revision, ...definition } = source;
  const packageComponent = await defineComponent({
    ...definition,
    id: "payload-interface",
    partNumber: "PAYLOAD-INTERFACE-01",
  });
  const initialState = await createAssemblyAuthoringState(await defineAssemblyDraft({
    id: "payload-workspace",
    geometryCoordinates: "assembly",
    components: [{
      instanceId: "fixture", componentRevision: source.revision, quantity: 1,
      transform: {
        position: { x: m(-0.4), y: m(0), z: m(0) },
        orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) },
      },
    }],
    targetEnvelope: source.envelope,
    preservedMounts: [], obstacleVolumes: [], accessVolumes: [],
    missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
  }), [source]);
  const inventory = defineInventory([
    { componentRevision: source.revision, ownedQuantity: 1, availability: "available" },
    { componentRevision: packageComponent.revision, ownedQuantity: 1, availability: "available" },
  ]);
  return { initialState, inventory, packageComponent };
}

test("stages and places a component through one revisioned workspace", async () => {
  const { initialState, inventory, packageComponent } = await workspaceFixture();
  const { result } = renderHook(() => useAssemblyWorkspace({ initialState, inventory }));
  const revision = result.current.revision;

  await act(() => result.current.stageComponent(packageComponent, revision));
  const stagedRevision = result.current.revision;
  const instance = {
    instanceId: "payload-interface-1",
    componentRevision: packageComponent.revision,
    quantity: 1,
    transform: {
      position: { x: m(0.4), y: m(0), z: m(0) },
      orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) },
    },
  };

  await act(() => result.current.placeComponent(instance, result.current.revision));

  expect(result.current.parts.some((part) => part.selectionId === instance.instanceId)).toBe(true);
  expect(result.current.conflicts).toEqual([]);
  expect(result.current.branch).toMatchObject({
    status: "staged",
    parentRevision: stagedRevision,
    revision: result.current.revision,
  });
  expect(result.current.receipts.map(({ action, outcome }) => [action, outcome.status])).toEqual([
    ["stage_component_definition", "succeeded"],
    ["place_component", "succeeded"],
  ]);
});

test("serializes async edits and rejects a second action with the superseded parent", async () => {
  const { initialState, inventory, packageComponent } = await workspaceFixture();
  const { result } = renderHook(() => useAssemblyWorkspace({ initialState, inventory }));
  const parentRevision = result.current.revision;
  const placement = {
    instanceId: "payload-interface-1", componentRevision: packageComponent.revision, quantity: 1,
    transform: {
      position: { x: m(0.4), y: m(0), z: m(0) },
      orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) },
    },
  };

  const stage = result.current.stageComponent(packageComponent, parentRevision);
  const stalePlacement = result.current.placeComponent(placement, parentRevision);
  const staleExpectation = expect(stalePlacement).rejects.toThrow(/parent revision is stale/i);

  await act(async () => { await stage; await staleExpectation; });
  expect(result.current.revision).not.toBe(parentRevision);
  expect(result.current.parts.some(({ selectionId }) => selectionId === placement.instanceId)).toBe(false);
  expect(result.current.receipts.at(-1)).toMatchObject({ action: "place_component", outcome: { status: "failed" } });
});

test("projects protected regions and compiles only the exact live revision", async () => {
  const { initialState, inventory } = await workspaceFixture();
  const { result } = renderHook(() => useAssemblyWorkspace({ initialState, inventory }));
  const parentRevision = result.current.revision;

  await act(() => result.current.protectRegion({
    id: "payload-keep-out",
    kind: "keep-out",
    volume: {
      kind: "box", id: "payload-keep-out", center: { x: m(0), y: m(0), z: m(0) },
      size: { x: m(0.02), y: m(0.02), z: m(0.02) },
      orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) },
    },
  }, parentRevision));

  expect(result.current.parts).toContainEqual(expect.objectContaining({ id: "payload-keep-out", appearance: "constraint" }));
  await expect(result.current.compileAssembly(parentRevision)).rejects.toThrow(/parent revision is stale/i);
  let compiled: Awaited<ReturnType<typeof result.current.compileAssembly>> | undefined;
  await act(async () => { compiled = await result.current.compileAssembly(result.current.revision); });
  expect(compiled).toMatchObject({
    revision: result.current.revision,
    protectedRegionIds: ["payload-keep-out"],
  });
  expect(result.current.receipts.at(-1)).toMatchObject({ action: "compile_assembly", affectedRevision: result.current.revision });
});

test("renders the solved transform after a constraint action", async () => {
  const { initialState, inventory, packageComponent } = await workspaceFixture();
  const { result } = renderHook(() => useAssemblyWorkspace({ initialState, inventory }));
  await act(() => result.current.stageComponent(packageComponent, result.current.revision));
  await act(() => result.current.placeComponent({
    instanceId: "payload-interface-1", componentRevision: packageComponent.revision, quantity: 1,
    transform: {
      position: { x: m(0.4), y: m(0), z: m(0) },
      orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) },
    },
  }, result.current.revision));

  await act(() => result.current.constrainComponent({
    id: "payload-to-fixture", kind: "concentric",
    moving: { instanceId: "payload-interface-1", interfaceId: "anchor" },
    fixed: { instanceId: "fixture", interfaceId: "anchor" },
  }, result.current.revision));

  expect(result.current.parts.find(({ selectionId }) => selectionId === "payload-interface-1")?.center).toEqual([-400, 0, 3]);
});
