# WebMCP demo agent runbook

Use this runbook to rehearse the recorded Structural Evolution demo. It keeps the
agent sequence deterministic while preserving a short, realistic user prompt.

## Recording setup

- Use Codex with the deployed app open in its in-app browser:
  `https://webmcp-structural-evolution.vercel.app/`.
- Select **Reference FPV drone** and keep the shared workbench visible.
- Do not open a raw gate URL or present raw JSON as the product experience.
- Start from a refreshed page with no topology operation running.

## Single paste-ready user prompt

```text
Inspect the current drone design, then generate one balanced topology candidate for that exact revision. Keep it as a reviewable estimate and do not promote or export it. When it finishes, summarize the constraints, runtime, material fraction, compliance, and what still requires human approval.
```

## Required agent sequence

1. Call `inspect_design_context` with `scope: "current"`.
2. Read the returned `contextRevision`, protected volumes, locks, capability, and
   valid next actions. Stop and explain the problem if the context is stale or
   WebGPU is unavailable.
3. Call `generate_topology_candidate` once with:
   - `parentRevision`: the exact returned `contextRevision`
   - `variant`: `balanced`
   - `hypothesis`: `Explore a connected frame candidate`
   - `prediction`: `The bounded field completes within the browser budget`
4. Leave the result as a reviewable branch. Do not promote, accept, export, or
   imply manufacturing readiness.
5. Summarize only values returned by the live tools. Explicitly distinguish the
   interactive estimate from validated engineering evidence.

## Expected visible result

- The workbench shows optimization activity while the candidate runs.
- **Review → Branches** shows the Balanced frame estimate and its metrics.
- **Use this frame** remains disabled at the estimate stage.
- **Review → Evidence** and **History** show the associated state and receipt.

## Recording edit rule

Keep the prompt paste, tool invocation, start of optimization, and final result in
real time. If the wait contains more than three seconds of no visible change,
jump-cut or speed up only that middle portion and label it with the actual solve
time shown by that take.
Do not speed up the opening, result metrics, or human-approval boundary.

## Measured rehearsal — September 3, 2026

- Full clean Codex turn: `185.4 s`.
- WebMCP portion, inspection start to first reviewable state: `61.8 s`.
- Candidate timing reported by the live dashboard: `28.0–30.9 s`.
- Manual intervention: none; generation was invoked exactly once.
- A no-tool follow-up explaining the approval boundary completed in `3.7 s`.

The uncut agent turn is too long for a three-minute submission. Record the full
screen action, compress the quiet middle of inspection/generation to roughly
`12–18 s`, and keep the final metrics and approval boundary at normal speed.
