# Title

Structural Evolution

## One-line Summary

A browser-native workbench where an AI agent and a human co-steer an editable physical assembly through typed WebMCP tools and visible, reviewable topology evidence.

## Problem

Early physical design is fragmented: a hardware engineer, a 3D model, a solver, and an AI assistant often operate in separate contexts. Screenshot-driven assistance cannot reliably see the active assembly revision, protected volumes, component positions, or whether a prior result is stale. That makes an agent's suggestion hard to trust and hard for a human to supervise.

## Solution

Structural Evolution keeps the agent and human in one browser workbench. WebMCP exposes bounded, typed operations over the live design state: inspect the exact context, select an approved typed assembly, generate a bounded topology candidate, compare eligible candidates, or stage a component import for human review. The same visible workspace then shows the assembly, action receipts, estimate/evidence labels, and the human-only decision boundary.

## Impact

For small drone and robotics teams, this is a more inspectable way to explore a physical concept before committing to a heavier engineering stack. It makes the agent useful without asking the human to trust hidden state or automatic promotion. The impact claim is deliberately narrow: the project demonstrates a browser-native collaboration pattern for early structural exploration, not a replacement for validated engineering or manufacturing approval.

## AI Use

The product uses WebMCP as the agent interface. The page registers typed tools through `document.modelContext.registerTool`; schemas constrain input, tool descriptions describe the exact live state, and tool responses return bounded facts. The agent can inspect the active design context and request a deterministic topology candidate, while the human continues to see and control the shared assembly. State-changing import work is staged for human review, and candidate acceptance remains human-only.

## Codex Use

OpenAI Codex was used to implement and iterate on the application, its typed tool contracts, tests, documentation, and release checks. Codex is also one of the tested WebMCP clients for the browser interaction shown in the demo flow. ChatGPT was used as an additional AI tool during the project.

## Key Features

- Shared editable 3D workbench with reference FPV-drone and SE-6 cobot demo assemblies.
- Typed WebMCP inspection, approved-assembly generation, candidate generation/comparison, component inspection, staged import, and bounded component-move tools.
- Same-origin module-worker topology execution with a Rust/Wasm reference solver and immutable action receipts.
- Review panel that separates agent prediction, interactive output/evidence, current plan state, and human authority.
- Protected volumes, named load cases, connected load paths, stale-plan marking after edits, and no automatic candidate promotion.

## Architecture

The public release is a static Vite + React + TypeScript application rendered with Three.js. WebMCP tools are page-local `document.modelContext.registerTool` registrations with bounded JSON schemas and read-only/untrusted-content annotations. The dashboard detects WebGPU capability; its interactive topology path runs in a same-origin module worker and dynamically loads Rust/Wasm. This release has no backend, remote solver, account system, or durable project storage.

## Testing

No credentials are required.

1. Open <https://webmcp-structural-evolution.vercel.app> in a current desktop browser and choose **Reference FPV drone**.
2. Check the shared 3D assembly and open **Review**. The evidence panel must state that agent prediction, output/evidence, and human authority are distinct.
3. In ChatGPT/Codex in-app browser with WebMCP enabled, invoke the prompts in [the demo script](docs/hackathon/demo-video-script.md). Verify the visible assembly/receipt changes and that no automatic promotion occurs.
4. For a local source verification, run `pnpm test:run` and `pnpm build` after `pnpm install` with the pinned Node and pnpm versions.

## Public Demo

<https://webmcp-structural-evolution.vercel.app>

## Public Repo

<https://github.com/SebastianBoehler/webmcp-structural-evolution>

The public repository includes the Apache-2.0 [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Demo Video

Video URL: **TODO — add the one public YouTube video URL after recording.**

The planned recording is under three minutes with audio; its shot-by-shot script is [docs/hackathon/demo-video-script.md](docs/hackathon/demo-video-script.md).

## Screenshot Shot List

1. [Agent-synchronized reference assembly](docs/submission/screenshots/01-agent-synchronized-assembly.png): the human and agent share the visible FPV-drone workbench after context inspection.
2. [Agent-ready optimization state](docs/submission/screenshots/02-agent-ready-to-optimize.png): the bounded **Generate balanced frame** action is visible for the current assembly.
3. [Human evidence review](docs/submission/screenshots/03-human-evidence-review.png): the evidence panel visibly separates prediction, measured output, plan state, and human authority.

## Readiness

The public demo returns successfully without credentials, the public repository is available with an Apache-2.0 license, and the Devpost draft project is <https://devpost.com/software/structural-evolution>. The remaining blocking asset is the single public under-three-minute YouTube video URL. The Devpost project is still a draft; nothing in this document submits it.

## Known Limitations

- Dashboard topology output is an interactive sparse-SIMP lattice estimate, not certified FEA or manufacturing approval.
- It does not provide free-form B-rep/STEP synthesis, nonlinear/contact/kinematic solving, CFD, thermal/fatigue validation, experimental validation, or flight approval.
- WebMCP depends on a client exposing `document.modelContext`; WebGPU-dependent paths require a compatible browser/device.
- There is no backend, remote compute, collaboration service, accounts, or durable project storage in this release.

## Official Form Fields

| Field | Answer |
| --- | --- |
| Submitter Type | Individual |
| Countries | [Germany] |
| Organization name | Leave blank (individual submission) |
| App Status | New |
| Existing-project explanation | Leave blank |
| Live URL | https://webmcp-structural-evolution.vercel.app |
| Testing instructions / credentials | No credentials required. Test with ChatGPT/Codex in-app browser with WebMCP using the instructions above. |
| Public code repository URL | https://github.com/SebastianBoehler/webmcp-structural-evolution |
| Tested WebMCP client | ChatGPT/Codex in-app browser with WebMCP |
| AI tools leveraged | OpenAI Codex and ChatGPT |
| Learning level | Significant |
| Career AI value | Yes |
