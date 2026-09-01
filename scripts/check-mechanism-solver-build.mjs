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

if (solverEntries.length !== 1) {
  throw new Error(`Expected one mechanism solver entry, found ${solverEntries.length}`);
}
if (workerAssets.length !== 1) {
  throw new Error(`Expected one mechanism solver worker asset, found ${workerAssets.length}`);
}

const solverPath = path.join(assetsDirectory, solverEntries[0]);
const source = await readFile(solverPath, "utf8");
const solverModule = await import(pathToFileURL(solverPath).href);

if (typeof solverModule.solveMechanismStudy !== "function") {
  throw new Error("Production mechanism solver entry does not export solveMechanismStudy");
}
if (!source.includes(workerAssets[0])) {
  throw new Error("Production mechanism solver entry does not reference its worker asset");
}
if (!source.includes("new Worker(")) {
  throw new Error("Production mechanism solver entry does not construct its worker");
}
