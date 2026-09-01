import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { FieldViewer } from "./FieldViewer";
import { current, grid, region } from "./field-viewer-test-support";
import { flightFrameTransform } from "./semantic-field-session";
import type { AssemblyVisualPart } from "./render-envelope";

const semantic = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock("./semantic-field-session", async (importOriginal) => ({
  ...await importOriginal<typeof import("./semantic-field-session")>(), mountSemanticFieldSession: semantic.mount,
}));

const session = {
  dispose: vi.fn(), setHighlightedBranch: vi.fn(), setSelectedPart: vi.fn(), setAssemblyPartPoses: vi.fn(),
  focusSelectedPart: vi.fn(), setFlightFrame: vi.fn(), setReferenceGridVisible: vi.fn(), setView: vi.fn(),
  setTransformSpace: vi.fn(), setTranslationSnap: vi.fn(), updateModel: vi.fn(),
};

const part = (center: readonly [number, number, number]): AssemblyVisualPart => ({
  id: "motor", selectionId: "motor", label: "Motor", appearance: "component",
  kind: "cylinder", center, radius: 2, height: 4,
});

beforeEach(() => {
  semantic.mount.mockReset();
  Object.values(session).forEach((method) => method.mockClear());
  semantic.mount.mockResolvedValue(session);
});
afterEach(cleanup);

test("replays current selection, view, grid, and transform state after async semantic mount", async () => {
  let resolve!: (value: typeof session) => void;
  semantic.mount.mockReturnValueOnce(new Promise<typeof session>((done) => { resolve = done; }));
  render(<FieldViewer current={null} alternatives={[]} selectedRegion={region} threshold={.5} mode="overlay"
    grid={grid} selectedPart="motor" selectedAlternative="candidate"/>);

  resolve(session);
  await waitFor(() => expect(session.setSelectedPart).toHaveBeenCalledWith("motor"));
  expect(session.setHighlightedBranch).toHaveBeenCalledWith("candidate");
  expect(session.setReferenceGridVisible).toHaveBeenCalledWith(true);
  expect(session.setView).toHaveBeenCalledWith("isometric");
  expect(session.setTransformSpace).toHaveBeenCalledWith("world");
  expect(session.setTranslationSnap).toHaveBeenCalledWith(10);
});

test("maps flight attitude to rotation rather than translation", () => {
  const matrix = flightFrameTransform([0, 0, Math.PI / 2]);
  expect(matrix.slice(0, 4)).toEqual([expect.closeTo(0), 1, expect.closeTo(0), 0]);
  expect(matrix.slice(4, 8)).toEqual([-1, expect.closeTo(0), 0, 0]);
  expect(matrix.slice(12, 15)).toEqual([0, 0, 0]);
});

test("updates one mounted semantic viewport across model, revision, and callback changes", async () => {
  const firstSelect = vi.fn();
  const secondSelect = vi.fn();
  const view = render(<FieldViewer current={null} alternatives={[]} selectedRegion={region}
    threshold={.5} mode="overlay" grid={grid} assemblyParts={[part([0, 0, 0])]}
    onPartSelect={firstSelect}/>);
  await waitFor(() => expect(semantic.mount).toHaveBeenCalledOnce());
  await waitFor(() => expect(session.setView).toHaveBeenCalled());

  view.rerender(<FieldViewer current={current} alternatives={[]} selectedRegion={region}
    threshold={.6} mode="overlay" grid={grid} assemblyParts={[part([4, 5, 6])]}
    onPartSelect={secondSelect}/>);

  await waitFor(() => expect(session.updateModel).toHaveBeenCalledWith(
    expect.objectContaining({ currentInstances: expect.any(Uint32Array),
      assemblyParts: [expect.objectContaining({ center: [4, 5, 6] })] }),
    "accepted",
  ));
  expect(semantic.mount).toHaveBeenCalledOnce();
  const interactions = semantic.mount.mock.calls[0]?.[4];
  interactions?.onSelect?.("motor");
  expect(firstSelect).not.toHaveBeenCalled();
  expect(secondSelect).toHaveBeenCalledWith("motor");
  expect(session.dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(session.dispose).toHaveBeenCalledOnce();
});

test("does not replay an unchanged controlled component over a leaf after a model rebuild", async () => {
  function Controlled({ accepted }: { readonly accepted: boolean }) {
    const [selected, setSelected] = useState<string>();
    return <FieldViewer current={accepted ? current : null} alternatives={[]} selectedRegion={region}
      threshold={.5} mode="overlay" grid={grid} selectedPart={selected}
      assemblyParts={[part(accepted ? [1, 0, 0] : [0, 0, 0])]}
      onPartSelect={setSelected}/>;
  }
  const view = render(<Controlled accepted={false}/>);
  await waitFor(() => expect(semantic.mount).toHaveBeenCalledOnce());
  const interactions = semantic.mount.mock.calls[0]?.[4];
  act(() => interactions?.onSelect?.("motor"));
  await waitFor(() => expect(session.setSelectedPart).toHaveBeenCalledWith("motor"));
  const controlledEchoCount = session.setSelectedPart.mock.calls
    .filter(([selection]) => selection === "motor").length;

  view.rerender(<Controlled accepted/>);
  await waitFor(() => expect(session.updateModel).toHaveBeenCalledWith(expect.anything(), "accepted"));
  expect(session.setSelectedPart.mock.calls
    .filter(([selection]) => selection === "motor")).toHaveLength(controlledEchoCount);
});

test("replays the newest model after a pending mount and disposes a late stale session", async () => {
  let resolveFirst!: (value: typeof session) => void;
  semantic.mount.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
  const view = render(<FieldViewer current={null} alternatives={[]} selectedRegion={region}
    threshold={.5} mode="overlay" grid={grid} assemblyParts={[part([0, 0, 0])]}/>);
  view.rerender(<FieldViewer current={current} alternatives={[]} selectedRegion={region}
    threshold={.5} mode="overlay" grid={grid} assemblyParts={[part([7, 8, 9])]}/>);
  resolveFirst(session);
  await waitFor(() => expect(session.updateModel).toHaveBeenCalledWith(
    expect.objectContaining({ assemblyParts: [expect.objectContaining({ center: [7, 8, 9] })] }),
    "accepted",
  ));
  expect(semantic.mount).toHaveBeenCalledOnce();
  view.unmount();

  const lateSession = { ...session, dispose: vi.fn(), updateModel: vi.fn() };
  let resolveLate!: (value: typeof lateSession) => void;
  semantic.mount.mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve; }));
  const stale = render(<FieldViewer current={null} alternatives={[]} selectedRegion={region}
    threshold={.5} mode="overlay" grid={grid}/>);
  stale.unmount();
  resolveLate(lateSession);
  await waitFor(() => expect(lateSession.dispose).toHaveBeenCalledOnce());
  expect(lateSession.updateModel).not.toHaveBeenCalled();
});

test("surfaces model mount and later capture failures as visible WebGPU alerts", async () => {
  semantic.mount.mockRejectedValueOnce(new Error("Unsupported WebGPU semantic model asset: robot"));
  const view = render(<FieldViewer current={null} alternatives={[]} selectedRegion={region}
    threshold={.5} mode="overlay" grid={grid} assemblyParts={[{
      id: "robot", selectionId: "robot", label: "Robot", appearance: "component",
      kind: "model", center: [0, 0, 0], size: [1, 1, 1], assetUrl: "/robot.glb", assetUnits: "mm",
    }]}/>);
  expect((await screen.findByRole("alert")).textContent)
    .toMatch(/unsupported webgpu semantic model asset: robot/i);

  semantic.mount.mockResolvedValueOnce(session);
  view.rerender(<FieldViewer current={null} alternatives={[]} selectedRegion={region}
    threshold={.5} mode="overlay" grid={grid} assemblyParts={[part([0, 0, 0])]}/>);
  await waitFor(() => expect(semantic.mount).toHaveBeenCalledTimes(2));
  semantic.mount.mock.calls[1]?.[3]?.(new Error("capture submission failed"));
  expect((await screen.findByRole("alert")).textContent).toMatch(/capture submission failed/i);
});
