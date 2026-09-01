import { expect, it } from "vitest";

import { sourceDocument } from "../engineering/job-runner-test-fixtures";
import { evaluateCad } from "./workspace-cad";
import { cadAdapter, cadResult } from "./workspace-test-fixtures";

const request = (revision: string) => ({
  requestId: "cad-boundary",
  expectedRevision: revision,
  outputs: ["step"] as const,
  settings: {},
});

it("prepares exact CAD payload entries without owning the durable commit", async () => {
  const document = await sourceDocument();
  const adapter = cadAdapter(async (value, _signal, emit) => emit(await cadResult(value)));

  const evaluated = await evaluateCad(
    adapter, document, request(document.revision), new AbortController().signal,
  );
  expect(evaluated.inputs).toHaveLength(1);
  expect(evaluated.inputs[0]?.record).toBe(evaluated.artifacts[0]);
});

it("fails closed on multiple CAD terminals", async () => {
  const document = await sourceDocument();
  const adapter = cadAdapter(async (value, _signal, emit) => {
    emit(await cadResult(value, 1));
    emit(await cadResult(value, 2));
  });

  await expect(evaluateCad(
    adapter, document, request(document.revision), new AbortController().signal,
  )).rejects.toThrow(/multiple|terminal/i);
});

it("fails closed on a terminal whose request binding differs", async () => {
  const document = await sourceDocument();
  const adapter = cadAdapter(async (value, _signal, emit) => emit({
    ...await cadResult(value), requestId: "other-request",
  }));

  await expect(evaluateCad(
    adapter, document, request(document.revision), new AbortController().signal,
  )).rejects.toThrow(/request|binding/i);
});

it("fails closed when a success omits its requested output", async () => {
  const document = await sourceDocument();
  const adapter = cadAdapter(async (value, _signal, emit) => emit({
    ...await cadResult(value), results: [],
  }));

  await expect(evaluateCad(
    adapter, document, request(document.revision), new AbortController().signal,
  )).rejects.toThrow(/result|output|expected/i);
});

it("keeps cancellation terminal when an adapter emits a signal-ignoring late success", async () => {
  const document = await sourceDocument();
  const controller = new AbortController();
  const adapter = cadAdapter(async (value, _signal, emit) => {
    emit({ requestId: value.requestId, state: "cancelled", workerDisposition: "quarantined" });
    controller.abort();
    emit(await cadResult(value));
  });

  await expect(evaluateCad(
    adapter, document, request(document.revision), controller.signal,
  )).rejects.toThrow(/abort/i);
});
