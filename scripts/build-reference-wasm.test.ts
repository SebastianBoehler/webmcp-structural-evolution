import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve("scripts/build-reference-wasm.sh");
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(resolve(tmpdir(), "wasm-pack-check-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFakeWasmPack(directory: string, version: string): void {
  const executable = resolve(directory, "wasm-pack");
  writeFileSync(
    executable,
    `#!/bin/sh
if [ "\${1-}" = "--version" ]; then
  printf '%s\\n' '${version}'
  exit 0
fi
printf '%s\\n' "$*" > "$WASM_PACK_ARGS_FILE"
`,
  );
  chmodSync(executable, 0o755);
}

function runBuildScript(path: string, argumentsFile?: string) {
  return spawnSync("/bin/sh", [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: path,
      WASM_PACK_ARGS_FILE: argumentsFile,
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("reference Wasm build bootstrap", () => {
  it("is the implementation behind pnpm wasm:build", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["wasm:build"]).toBe("sh scripts/build-reference-wasm.sh");
  });

  it("fails actionably when wasm-pack is absent", () => {
    const result = runBuildScript(temporaryDirectory());

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "cargo install wasm-pack --version 0.15.0 --locked",
    );
  });

  it("fails actionably when wasm-pack has the wrong version", () => {
    const directory = temporaryDirectory();
    writeFakeWasmPack(directory, "wasm-pack 0.14.0");

    const result = runBuildScript(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("found wasm-pack 0.14.0");
    expect(result.stderr).toContain(
      "cargo install wasm-pack --version 0.15.0 --locked",
    );
  });

  it("delegates the build only to wasm-pack 0.15.0", () => {
    const directory = temporaryDirectory();
    const argumentsFile = resolve(directory, "arguments.txt");
    writeFakeWasmPack(directory, "wasm-pack 0.15.0");

    const result = runBuildScript(directory, argumentsFile);

    expect(result.status).toBe(0);
    expect(readFileSync(argumentsFile, "utf8").trim()).toBe(
      "build crates/reference --target web --out-dir ../../src/reference/pkg",
    );
  });
});
