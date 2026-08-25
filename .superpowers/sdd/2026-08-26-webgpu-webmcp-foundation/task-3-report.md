# Task 3 Report: Rust/Wasm Numerical Oracle

## Scope

Implemented Task 3 only from starting HEAD `22e8bbcca8b0fb554853ec202eec242affe30067` in the isolated `foundation` worktree. No Task 1/2 behavior or later WebGPU, viewer, or WebMCP work was changed.

## Toolchain setup

- Bundled runtime: Node `v24.19.0`, pnpm `10.15.0`.
- Initial Rust toolchain: rustc `1.77.2`, cargo `1.77.2`, rustup `1.29.0`.
- Initial required install command: `cargo install wasm-pack --version 0.15.0 --locked`.
- Initial result: exit 101 because Cargo 1.77.2 could not parse wasm-pack 0.15.0's version-4 lockfile.
- Resolution: updated the existing stable toolchain with `rustup toolchain install stable --profile minimal`.
- Final Rust toolchain: rustc `1.98.0`, cargo `1.98.0`, rustup `1.29.0`.
- Re-ran exactly `cargo install wasm-pack --version 0.15.0 --locked`; exit 0, installed `wasm-pack 0.15.0`.
- Ran `rustup target add wasm32-unknown-unknown`; exit 0. Installed targets are `aarch64-apple-darwin` and `wasm32-unknown-unknown`.

## RED evidence

1. Rust public seam:
   - Command: `cargo test --manifest-path crates/reference/Cargo.toml`
   - Result: exit 101; `unresolved import super::relative_l2_core`, proving the behavior tests preceded the implementation.
2. TypeScript wrapper seam:
   - Command: `PATH=/Users/sebastianboehler/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm vitest run src/reference`
   - Result: exit 1; Vite could not resolve the missing `./index` wrapper.
3. Generated-package boundary:
   - The same focused Vitest command then failed because `./pkg/webmcp_reference.js` did not exist. `pnpm wasm:build` supplied the real wasm-pack package before the GREEN run.

## Implementation decisions

- `relative_l2_core` rejects either empty input, unequal lengths, and every NaN or infinity in either vector.
- The ratio is `||expected - actual||₂ / ||expected||₂`. An all-zero expected vector returns the stable `zero-denominator` error even when both vectors are equal; no undefined ratio is converted to zero, NaN, or infinity.
- f32 inputs are converted before arithmetic and accumulated with f64 `mul_add`. Both sums and the ratio are checked for finiteness, and results outside finite f32 range return `result-out-of-range` before casting.
- Rust failures have stable codes and messages. The wasm-bindgen export throws a JavaScript `Error` named `RelativeL2Error` with a `code` property, allowing the TypeScript/application layer to surface failures directly.
- `relativeL2` accepts typed `Float32Array` arguments, validates them before loading Wasm, and uses one module-scoped initialization promise. A rejected initializer remains rejected and shared; there is no JavaScript numerical fallback.
- wasm-bindgen and js-sys are exact-pinned in `Cargo.toml`, and `Cargo.lock` is committed for reproducibility.
- Only `webmcp_reference.js`, `webmcp_reference_bg.wasm`, and `webmcp_reference.d.ts` are committed from `src/reference/pkg`; wasm-pack's nested `.gitignore`, package metadata, and background-Wasm declaration are reproducible extras and are intentionally omitted.
- All authored Rust/TypeScript sources are below the 300-line soft limit; the largest is `crates/reference/src/lib.rs` at 174 lines.

## GREEN and final verification

All pnpm commands used the required bundled Node directory prepended to `PATH`.

- `cargo test --manifest-path crates/reference/Cargo.toml`: exit 0; 7 passed, 0 failed, plus 0 doc tests.
- `pnpm wasm:build`: exit 0; optimized web-target package generated under `src/reference/pkg`.
- `pnpm vitest run src/reference`: exit 0; 1 file passed, 4 tests passed.
- `pnpm test:run`: exit 0; 4 files passed, 24 tests passed.
- `pnpm build`: exit 0; TypeScript validation and Vite production build passed, 16 modules transformed.
- `git diff --check` and `git diff --cached --check`: exit 0; no whitespace errors.

## Files changed

- `.gitignore`
- `crates/reference/Cargo.toml`
- `crates/reference/Cargo.lock`
- `crates/reference/src/lib.rs`
- `src/reference/index.ts`
- `src/reference/index.test.ts`
- `src/reference/pkg/webmcp_reference.js`
- `src/reference/pkg/webmcp_reference_bg.wasm`
- `src/reference/pkg/webmcp_reference.d.ts`
- `.superpowers/sdd/2026-08-26-webgpu-webmcp-foundation/task-3-report.md`

## Concerns

- wasm-pack reported that no prebuilt wasm-bindgen CLI binary matched the platform and used its cargo-installed `wasm-bindgen 0.2.127`; the build completed successfully and subsequent builds reuse the cached binary.
- wasm-pack also emitted optional metadata/license-file discovery warnings for the nested crate. The crate declares SPDX `Apache-2.0`, and the repository root contains the full Apache-2.0 license; no duplicate crate-local license file was added.
