import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const assetsDirectory = path.resolve("dist/assets");
const assets = await readdir(assetsDirectory);
const solverEntries = assets.filter((name) =>
  /^mechanism-solver-[\w-]+\.js$/.test(name) && !name.startsWith("mechanism-solver-worker-")
);
const workerAssets = assets.filter((name) =>
  /^mechanism-solver-worker-[\w-]+\.js$/.test(name)
);

if (solverEntries.length === 0) {
  throw new Error("Expected at least one mechanism solver entry");
}
if (workerAssets.length !== 1) {
  throw new Error(`Expected one mechanism solver worker asset, found ${workerAssets.length}`);
}

const entries = await Promise.all(solverEntries.map(async (name) => {
  const solverPath = path.join(assetsDirectory, name);
  return { name, source: await readFile(solverPath, "utf8"),
    module: await import(pathToFileURL(solverPath).href) };
}));
const publicEntries = entries.filter(({ module }) => typeof module.solveMechanismStudy === "function");
if (publicEntries.length !== 1) {
  throw new Error(`Expected one public mechanism solver entry, found ${publicEntries.length}`);
}
const workerOwners = entries.filter(({ source }) =>
  source.includes(workerAssets[0]) && source.includes("new Worker("));
if (workerOwners.length !== 1) {
  throw new Error(`Expected one mechanism solver worker-owning chunk, found ${workerOwners.length}`);
}
