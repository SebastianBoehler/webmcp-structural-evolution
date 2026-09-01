// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import {
  MECHANISM_SOLVER_BUILD_DIGEST, MECHANISM_WASM_MODULE_DIGEST,
} from "./mechanism-solver-provenance";

const digest = async (relativePath: string) => createHash("sha256")
  .update(await readFile(new URL(relativePath, import.meta.url))).digest("hex");

test("pins provenance to the installed deterministic Rapier source and Wasm bytes", async () => {
  await expect(digest("../../node_modules/@dimforge/rapier3d-deterministic-compat/rapier.mjs"))
    .resolves.toBe(MECHANISM_SOLVER_BUILD_DIGEST);
  await expect(digest("../../node_modules/@dimforge/rapier3d-deterministic-compat/rapier_wasm3d_bg.wasm"))
    .resolves.toBe(MECHANISM_WASM_MODULE_DIGEST);
});
