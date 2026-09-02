# Structural Evolution demo video script

Target: 2:35–2:50, with roughly 350 spoken words. Record the deployed dashboard, not a raw gate route or raw JSON page. Keep the WebMCP tool activity and the resulting dashboard state visible whenever possible.

## Timed storyboard

| Time | Picture | Narration |
| --- | --- | --- |
| 0:00–0:10 | Open the deployed dashboard on **Reference FPV drone** and orbit the visible assembly once. | “This is Structural Evolution, a browser-native physical-engineering workbench. A human and an AI agent share one editable design state: the drone, its constraints, its experiments, and the evidence stay visible together from the first frame.” |
| 0:10–0:35 | Open **Review → Agents**. Paste Prompt 1 and keep the registration/activity state in view. | “I start with inspection. The agent receives typed facts about the exact revision, selected design region, protected volumes, locks, and valid next actions. WebMCP gives it a narrow, page-local vocabulary. It does not reconstruct a hidden CAD model from screenshots, and it cannot reach outside the workbench through this interface.” |
| 0:35–0:58 | Paste Prompt 2. Keep the shared 3D world and the activity receipt visible as the approved drone template is selected. | “Now the agent requests the approved reference assembly and inspects it again. The result is immediately visible in the same world I supervise. This is intentionally bounded assembly generation: approved typed parts and constraints, not free-form manufacturing geometry.” |
| 0:58–1:35 | Paste Prompt 3. Show the running status, then switch to **Optimize** and show the candidate in the viewport/result panel. | “With the current revision, the agent requests one balanced topology candidate. The browser runs a bounded deterministic sparse-SIMP lattice estimate in a same-origin worker with Rust and Wasm. Named loads, supports, protected volumes, and the assembly revision travel together. The candidate is a reviewable branch tied to this design, not a generic answer or a manufacturing decision.” |
| 1:35–2:05 | Open **Review → Evidence**, then **History**. Show prediction, measured output, plan state, and the receipt. | “The review surface keeps four things separate: what the agent predicted, what the interactive run measured, whether the plan is still current, and who has authority. The receipt identifies the action and revision. If I change a relevant component or constraint, the previous plan becomes stale instead of being presented as current evidence. Because the response carries revision identifiers, I can follow its next action while checking the same visual context.” |
| 2:05–2:40 | Open **Branches** and point to **Use this frame**, then return to the dashboard and show the public URL. | “The final boundary is human control. The agent may inspect, request a candidate, compare eligible branches, or stage an import for review. Only the human can approve an import or use a frame. These results are early-design estimates, not certified FEA, flight validation, or manufacturing approval. The public dashboard and repository make the tools, receipts, and limitations inspectable without credentials. The scope is intentionally small, but the loop is complete and understandable.” |

## Paste-ready prompts

Prompt 1:

```text
Inspect the current design context. Summarize the active assembly revision, protected volumes, locks, and valid next action. Do not modify anything.
```

Prompt 2:

```text
Use generate_approved_assembly with templateId reference-drone, then inspect the current design context again. Do not import or move any components.
```

Prompt 3:

```text
First call inspect_design_context with scope current. Then call generate_topology_candidate with parentRevision set to that returned contextRevision, variant balanced, hypothesis "Explore a connected frame candidate", and prediction "The bounded field completes within the browser budget". Keep the result as a reviewable branch. Do not promote or export it.
```

## Backup shots

- Deployed dashboard at the reference drone, with the editable assembly visible in the first shot.
- **Review → Agents** showing registered tool status and the typed tool descriptions.
- **Optimize** showing the balanced candidate and its result panel, followed by **Review → Evidence** and **History**.
- If the recording client cannot invoke WebMCP, state that plainly and use these production screenshots only as supporting views; do not imply a live agent invocation.
