# Foundation browser gate

Date: 2026-08-26

Verdict: **partially passed**. The real in-app browser passed the WebGPU/Wasm and judge-journey checks, but did not expose `document.modelContext`. The mandatory combined in-app-browser WebGPU + WebMCP gate therefore did not pass.

## Target browser facts

- Browser: Codex In-app Browser, Chromium user agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36`.
- Origin: `http://127.0.0.1:5174`. Vite selected 5174 because 5173 was already occupied.
- Default viewport: 1280 × 720 CSS pixels at DPR 2.
- Browser console: no warnings or errors after the complete human journey.
- The page reported WebGPU device acquisition success. The browser-control evaluation sandbox masks privileged globals, so the page's shipped capability detector and measured probe are the authoritative observations.

## WebGPU and Wasm

The primary action ran the shipped 32³ WebGPU compute probe, read the GPU buffer back, and compared it with the Rust/Wasm oracle.

| Observation | Measured result |
|---|---|
| Capability | `available` — adapter and device acquisition succeeded |
| Baseline elapsed time | 139.35 ms |
| Baseline relative L2 | `3.7204763714271394e-8` |
| Required tolerance | `5e-6` |
| Baseline result | `verified` |
| Result digest | `8009d67b2a36196fc773c0aeea94f143b5fe335d7d9d30dc22604d0f599d5925` |

Two further real branches also verified. Their exact shared-parent comparison produced a 91.31 ms timing delta and `5.5373163831973216e-9` relative-L2 delta. The anchored semantic table reported 2,500 and 2,663 removed local voxels for the two alternatives; overlay, peel, and audition controls remained tied to the same assembly anchor.

No numerical mismatch occurred in the real browser. Mismatch stripping and promotion blocking remain covered by the deterministic probe/project-state tests; this run does not claim a measured mismatch-path pass.

## WebMCP target-browser outcome

The in-app browser rendered: `WebMCP is unavailable in this browser context.` No target-browser tools were discoverable, so the required in-app-browser Available Tools list, manual invocation history, and WebMCP DevTools pane could not be verified. The DevTools pane is not exposed through the in-app browser control surface used for this run.

This is a gate blocker, not an application fallback. The UI stayed usable and did not claim WebMCP support.

## Supplemental Chrome protocol checks

These checks used local Chrome with `--enable-features=WebMCP` through GoogleChromeLabs' current `webmcp-tools` source at commit `9626f8d568a223d8143790640c07f7800c733103`. They prove the page contract outside the mandatory in-app-browser target; they do not replace the failed target-browser requirement.

| Check | Result |
|---|---|
| Initial discovery | `inspect_design_context`, `run_foundation_probe`; compare correctly absent until two comparable branches exist |
| Manual success | `inspect_design_context({scope:"current"})` succeeded |
| Validation error | `scope:"all"` failed with `Invalid input: expected "current"` |
| Ordered success chain | baseline → edge-biased → compare passed in order |
| Mid-chain failure | compare was unavailable after only one verified branch: `no tool named "compare_foundation_probes" was found` |
| Cancellation | protocol invocation returned `status: "Canceled"` |

The cancellation result confirms the browser protocol outcome. `use-webmcp-tool` 0.2 does not pass an invocation abort signal into the page callback, so this run did not establish GPU-kernel interruption or branch rollback after protocol cancellation. No promotion occurred and no substitute result was introduced.

## Official WebMCP evals

Dataset: `docs/testing/webmcp-foundation-evals.json`.

- The published `webmcp-evals` package available during this run did not yet include the documented `smoke` command (`unknown command 'smoke'`).
- The current GoogleChromeLabs source runner (`webmcp-evals` 0.0.3 at the commit above) ran deterministic smoke mode on local Chrome.
- Result: **5/5 required steps passed across 3 cases**: two exact context inspections and the ordered baseline → edge-biased → compare chain.
- Measured smoke probes were verified at relative L2 `3.7204763714271394e-8` and `2.8865247969633856e-8`.
- A configured Anthropic backend existed, so one probabilistic browser-eval run was attempted with `anthropic:claude-sonnet-4-5`. It completed with **0/3** because the provider returned `Your credit balance is too low to access the Anthropic API`; no model-selection claim is made.
- Direct, ambiguous, and negative-selection behavior therefore has no probabilistic pass in this run. The deterministic smoke invokes authored calls directly and is not evidence of model selection quality.
- No Google, OpenAI, or live Ollama backend was configured.

## Human journey and access checks

- Human promotion moved only the exact verified non-stale baseline into the accepted lineage.
- Two later sibling alternatives shared the exact current context revision and rendered in situ. No route/path comparison UI was introduced.
- Locking `cable-clearance` changed the semantic selection and locks, marked all prior branches stale, cleared the active comparison, and disabled every promotion button.
- Semantic DOM retained the exact fixture revision, selection and voxel bounds, modes, parent/branch identities, local deltas, measurements, receipts, and stale state outside the canvas.
- At 390 × 844, the main region measured `clientWidth === scrollWidth === 375`; both semantic tables and all three mode radios remained present.
- Native keyboard traversal was confirmed in supplemental Chrome: primary action → intervention → comparison radio group → scrollable semantic table → protocol details. The in-app automation surface did not move focus when issuing Tab, so keyboard traversal was not independently confirmed there.
- Reduced motion was emulated in supplemental Chrome: the media query matched and computed root `scroll-behavior` was `auto`. Viewer tests separately verify damping/animation suppression with the preference enabled.
- The real target browser's system reduced-motion preference was off. No preference was overridden in that target.
- Unsupported WebMCP copy was observed in the real in-app browser. An unsupported WebGPU browser was not available; deterministic capability tests cover the visible unavailable state.

## Commands

```text
PATH=/Users/sebastianboehler/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm vitest run src/app/FoundationJourney.test.tsx
PATH=/Users/sebastianboehler/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm check
PATH=/Users/sebastianboehler/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm dev --host 127.0.0.1
node dist/bin/webmcp-evals.js smoke -u http://127.0.0.1:5174 -e docs/testing/webmcp-foundation-evals.json --chrome-channel chrome -v
node dist/bin/webmcp-evals.js -b vercel -m anthropic:claude-sonnet-4-5 -r 1 --max-steps 5 --reporter console json -o /tmp/webmcp-foundation-evals browser -u http://127.0.0.1:5174 -e docs/testing/webmcp-foundation-evals.json --chrome-channel chrome
git diff --check
```
