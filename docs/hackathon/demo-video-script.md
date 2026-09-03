# Structural Evolution demo video script

Target edited runtime: **2:46**, under three minutes. Record the deployed
dashboard, not a raw gate route or JSON page. Start on **SE-6 six-axis cobot**
and use the two prompts in [`demo-agent-runbook.md`](./demo-agent-runbook.md).

## Timed storyboard

| Time | Clicks and visible action | Spoken narration | Edit rule |
| --- | --- | --- | --- |
| 0:00–0:10 | Start on deployed **SE-6 six-axis cobot** in **Assemble** with Safety zones off. Orbit once, then open **Review → Agents**. | “Structural Evolution is a browser-native physical-engineering workbench. I begin on this approved SE-6 assembly, where the human and agent share one visible engineering state.” | Real time. Do not move components. |
| 0:10–0:20 | Send Prompt 1 only. Keep the agent activity and visible assembly switch in frame. | “The first bounded action selects the approved reference-drone template. It replaces the shared world with known typed assembly data; it does not invent arbitrary CAD.” | Real time. |
| 0:20–0:39 | Wait for **Reference FPV drone** to appear, then for fresh tool-registration status in **Review → Agents**. Let Codex refetch the tool set. | “A fixture change remounts the workbench, so I wait for the reference-drone tools to re-register and for the agent to refetch them. That prevents an old assembly handle from acting on this new world.” | Real time. This is required visible proof, not quiet-wait footage. |
| 0:39–0:55 | Return to **Assemble**, turn **Safety zones** on, orbit the reference drone around protected geometry and mounted parts, then send Prompt 2 with the fresh tools. | “Now I expose the safety geometry and supervise the drone in the viewport. The agent reads actual component positions and layout state, then the exact design context and revision. I do not move a component, so there is no layout-validation detour.” | Real time. Safety zones do not show load vectors here. |
| 0:55–1:20 | Prompt 2 reads the component library, inspects the current context, and starts one balanced candidate from its returned revision. Keep the running status and safety geometry visible. | “From that returned revision, the agent starts one balanced frame candidate. It is a constrained proposal attached to this assembly, not a change to the accepted design.” | If the middle has over three seconds without a visible change, speed up or cut only that quiet wait and label it with this take’s displayed solve time. |
| 1:20–1:40 | Hold the viewport on **Interactive estimate preview** and **Unverified · unaccepted**. | “This is a visible interactive topology estimate. It is not topology verification, stress FEA, or a manufacturing decision.” | Real time; make both labels legible. |
| 1:40–2:09 | Open **Review → Branches** and show the Balanced frame plus disabled **Use this frame**. Then open **Evidence** and **History**. | “Branches shows the estimate, but Use this frame is disabled. Evidence separates prediction, interactive output, plan state, and human authority. History records this remounted workbench’s context inspection and topology-candidate receipts; assembly generation and component-library inspection are not ledger receipts.” | Real time; do not promote, export, compare, or validate. |
| 2:09–2:36 | Click **Simulate**; open **Current assembly replay**, select **Full assembly** and one scenario, then press **Run replay**. Show moving vectors and readouts; pause after a few seconds. | “Only during this replay do we show loads: deterministic current-assembly loads and rigid-body motion from its mass and motor mounts. This is not topology validation, structural stress analysis, or flight approval.” | Real time; retain the boundary copy. |
| 2:36–2:46 | Return to the reference-drone review boundary or replay panel. | “The complete loop is an approved assembly, live agent inspection, supervised proposal, preserved review evidence, and human control.” | Real time. End before 3:00. |

## Director notes

- Use exactly two prompts. Prompt 1 is assembly generation only. Prompt 2 begins
  only after visible remount, fresh registration, and tool-set refetch, then runs
  component-layout inspection, design-context inspection, and one candidate.
- The presenter only orbits/rotates the camera and toggles **Safety zones**
  while the agent works. No manual component move, import, geometry edit, or
  layout validation is permitted.
- Hold the estimate before review so the unverified/unaccepted state is clear.
  Show load vectors only while current-assembly replay is running.
- If WebMCP is unavailable in the deployed recording browser, stop the live
  claim. Record the visible error; any older deployed take is supporting footage
  only and must be labelled as such.

## Backup shots

- SE-6 opening, then the visible reference-drone assembly generation result.
- The reference-drone **Review → Agents** registration state after remount.
- Safety zones around the reference drone while the camera orbits.
- The unverified estimate, **Branches** with disabled **Use this frame**,
  **Evidence**, and the two applicable **History** receipts.
- Current-assembly replay with moving vectors/readouts and its rigid-body/load
  boundary copy.
