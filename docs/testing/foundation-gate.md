# Foundation browser gate

Date: 2026-08-26

Verdict: **partially passed**. The real in-app browser passed the WebGPU/Wasm and judge-journey checks, but did not expose `document.modelContext`. The mandatory combined in-app-browser WebGPU + WebMCP gate therefore did not pass.

## Target browser facts

- Browser: Codex In-app Browser, Chromium user agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36`.
- Origin: `http://127.0.0.1:5174`. Vite selected 5174 because 5173 was already occupied.
- Default viewport: 1280 × 720 CSS pixels at DPR 2.
- Browser console: no warnings or errors after the complete human journey.
- The page reported WebGPU device acquisition success. The browser-control evaluation sandbox masks privileged globals, so the page's shipped capability detector and measured probe are the authoritative observations.
- During the Important-finding rerun, the browser runtime returned `Browser is not available: iab`; discovery showed only a connected Chrome extension. The earlier in-app measurements below remain the last target-browser evidence, and no refreshed in-app pass is claimed.

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

The protocol result confirms only the browser protocol outcome. `use-webmcp-tool` 0.2 still does not pass an invocation abort signal into the page callback, so protocol cancellation is not claimed to interrupt a GPU kernel.

Human cancellation is now a separate first-class application path. The project service owns an `AbortController`, passes its signal through the compute boundary, commits a canceled branch and receipt, and ignores any late runner result. A supplemental real Chrome run observed the visible cancel control, canceled copy, retry action, and no verified copy. The compute regression cancels a pending dispatch and verifies buffer/device cleanup; the state regression uses a deliberately signal-ignoring runner and verifies that its late verified result cannot commit or promote.

The final review rerun added an immediate-abort race in which the signal-aware runner resolves canceled synchronously from the abort event. The original `run_foundation_probe` promise now waits for the terminal canceled commit, returns `isError: true` with `status: "canceled"`, and records both the original run cancellation and the human cancel action. This was verified deterministically, not re-observed through the unavailable in-app browser. Protocol cancellation is still not claimed to interrupt the GPU kernel.

After two verified probes, a supplemental Chrome state check observed all three tools before human intervention. Clicking `Lock cable clearance` changed registration to exactly `inspect_design_context` and `run_foundation_probe`; compare disappeared. The subsequent inspect succeeded with `stale: true`, two total branches, one newest stale branch included, and `omittedBranchCount: 1`, keeping the result inside the 1,500-character contract.

Closing supplemental headless Chrome pages and changing dynamic registrations caused the Vite development client to log unhandled `AbortError: signal is aborted without reason` rejections from `use-webmcp-tool/useWebMCP.js:173`. The deterministic smoke and state checks still completed with their recorded results, but this third-party hook-cleanup warning is not hidden or counted as a clean supplemental-console pass.

## Official WebMCP evals

Dataset: `docs/testing/webmcp-foundation-evals.json`.

- The published `webmcp-evals` package available during this run did not yet include the documented `smoke` command (`unknown command 'smoke'`).
- The current GoogleChromeLabs source runner (`webmcp-evals` 0.0.3 at the commit above) ran deterministic smoke mode on local Chrome.
- The expanded dataset contains seven schema-valid cases: direct and ambiguous inspection, ordered success, negative no-tool selection, validation error, state-invalid mid-chain recovery, and post-intervention re-inspection.
- The current smoke runner requires at least one successful required call per case and treats an intentional tool error as a smoke error. Running the complete file therefore stops on the required `expectedCall: null` case; this is a runner limitation, not a no-tool pass.
- The five deterministic smoke-executable cases passed **8/8 required steps**: two inspections, baseline → edge-biased → compare, baseline → inspection when compare is not state-valid, and fresh inspection selection after an intervention prompt.
- The isolated validation-error case called `inspect_design_context({scope:"all"})` and produced the expected `Invalid input: expected "current"`; the runner correctly reported that deliberate error as 0/1 rather than a pass.
- The final deterministic rerun passed the same **8/8 required steps** after proposal/attempt identity was added. The baseline was 24.625 ms at relative L2 `3.7204763714271394e-8`; edge-biased was 10.080000042915344 ms at `2.8865247969633856e-8`. Their exact attempt revisions were `4612c20b9a1725fd9739d0046eb09c9e748d312c1434be2709ae31046e7f0fd1` and `0ce79a6d3c82e30cef3df63633b68d0806cee684bf5ef4f6a958e05319cf73d7`.
- A configured Anthropic backend existed, so one probabilistic browser-eval run was attempted with `anthropic:claude-sonnet-4-5`. It completed with **0/3** because the provider returned `Your credit balance is too low to access the Anthropic API`; no model-selection claim is made.
- Direct, ambiguous, negative, validation, mid-chain, and post-intervention selection behavior has no probabilistic pass in this run. The deterministic smoke invokes authored calls directly and is not evidence of model selection quality.
- No Google, OpenAI, or live Ollama backend was configured.

## Human journey and access checks

- Human promotion moved only the exact verified non-stale baseline into the accepted lineage.
- Two later sibling alternatives shared the exact current context revision and rendered in situ. No route/path comparison UI was introduced.
- Locking `cable-clearance` changed the semantic selection and locks, marked all prior branches stale, cleared the active comparison, and disabled every promotion button.
- Lock IDs are deduplicated and canonically sorted in shared state before equality, storage, and revision hashing. Reapplying an equivalent permuted intervention preserves the same context revision; the journey relabels the applied action `Cable clearance locked` and disables it.
- Failed, mismatched, and canceled attempts remain immutable rows. Identical retry intent retains one stable proposal revision while each execution has an explicit attempt number and distinct branch revision; all three identities are visible in the rail, inspection facts, tool output, and run receipts. A verified identical proposal remains non-repeatable.
- The newest measurement owns the primary evidence card. A preceding verification is shown only as explicitly labelled historical evidence, and a direct verified-then-mismatch regression confirms the mismatch cannot be promoted.
- The journey regression actively selects an anchored alternative and operates peel and audition modes rather than only checking that their controls exist.
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
node dist/bin/webmcp-evals.js smoke -u http://127.0.0.1:5174 -e <(jq '[.[] | select(.expectedCall != null and (.name | startswith("Validation error") | not))]' docs/testing/webmcp-foundation-evals.json) --chrome-channel chrome -v
node dist/bin/webmcp-evals.js smoke -u http://127.0.0.1:5174 -e <(jq '[.[] | select(.name | startswith("Validation error"))]' docs/testing/webmcp-foundation-evals.json) --chrome-channel chrome -v
node dist/bin/webmcp-evals.js -b vercel -m anthropic:claude-sonnet-4-5 -r 1 --max-steps 5 --reporter console json -o /tmp/webmcp-foundation-evals browser -u http://127.0.0.1:5174 -e docs/testing/webmcp-foundation-evals.json --chrome-channel chrome
git diff --check
```

The final deterministic rerun used the source runner at GoogleChromeLabs/webmcp-tools commit `9626f8d568a223d8143790640c07f7800c733103`. The complete seven-case file still stops before navigation on the intentional `expectedCall: null` case, and the isolated validation-error case still reports the expected tool error as 0/1. No probabilistic rerun was made because the only previously configured backend had already returned insufficient credit.
