# Structural Evolution demo video script

Target: 2:20–2:45, with roughly 320-380 spoken words. Record the deployed dashboard, not a raw gate route or raw JSON page. Keep the WebMCP tool activity and the resulting dashboard state visible whenever possible.

## Timed storyboard

| Time | Picture | Narration |
| --- | --- | --- |
| 0:00–0:10 | Open the deployed dashboard on **Reference FPV drone** and orbit the visible assembly once. | “This is Structural Evolution, a browser-native physical-engineering workbench. A human and an AI agent share one editable design state: the drone, its constraints, its experiments, and the evidence stay visible together from the first frame.” |
| 0:10–0:38 | Open **Review → Agents**. Paste Prompt 1 and keep the registration/activity state in view. | “I start with inspection. In the current production path the page registers six typed WebMCP tools, and the agent uses the same live workbench I see. It gets the exact revision, protected volumes, locks, and valid next actions from the page itself. That means it is not guessing hidden CAD state from screenshots, and it stays inside a narrow, reviewable tool boundary.” |
| 0:38–1:25 | Paste Prompt 2. Keep the shared 3D world and running status visible, then open **Review → Branches**. Show the Balanced frame estimate metrics and the disabled **Use this frame** control. | “From that exact revision, I ask for one balanced topology candidate. The browser runs a bounded deterministic sparse-SIMP lattice estimate in a same-origin worker with Rust and Wasm. The assembly revision, named loads, supports, and protected volumes travel together. In our production rehearsal this completed in about thirteen seconds and returned a reviewable Balanced frame estimate with visible metrics. It is useful immediately, but it is still an estimate, not a manufacturing decision or an accepted viewport result.” |
| 1:25–1:58 | Open **Review → Evidence**, then **History**. Show prediction, measured output, plan state, and the receipt. | “The review surface keeps four things separate: what the agent predicted, what the interactive run measured, whether the plan is still current, and who has authority. The receipt identifies the action and revision. If I change a relevant part or constraint, the prior plan becomes stale instead of pretending to stay current. The screenshots, numbers, and controls stay tied to the same review branch. That keeps the conversation attached to the exact state in front of me.” |
| 1:58–2:30 | Open **Branches** and point to the disabled **Use this frame** control, then return to the dashboard and show the public URL. | “The final boundary is human control. The generated branch is reviewable, but the dashboard does not let the agent promote it here. In the production rehearsal, Use this frame remained disabled at the estimate stage. That is the point of Structural Evolution: the agent can inspect and propose inside the live workbench, while the human retains approval. The public dashboard and repository are open without credentials, and the limitations are visible with the result.” |

## Paste-ready prompts

For the controlled one-prompt recording path, use
[`demo-agent-runbook.md`](./demo-agent-runbook.md). The two-step prompts below
remain useful when recording inspection and generation as separate sections.

Prompt 1:

```text
Inspect the current design context. Summarize the active assembly revision, protected volumes, locks, and valid next action. Do not modify anything.
```

Prompt 2:

```text
First call inspect_design_context with scope current. Then call generate_topology_candidate with parentRevision set to that returned contextRevision, variant balanced, hypothesis "Explore a connected frame candidate", and prediction "The bounded field completes within the browser budget". Keep the result as a reviewable branch. Do not promote or export it.
```

## Backup shots

- Deployed dashboard at the reference drone, with the editable assembly visible in the first shot.
- **Review → Agents** showing registered tool status and the typed tool descriptions.
- **Review → Branches** showing the Balanced frame estimate metrics and disabled **Use this frame** control, followed by **Review → Evidence** and **History**.
- If the recording client cannot invoke WebMCP, state that plainly and use these production screenshots only as supporting views; do not imply a live agent invocation.
