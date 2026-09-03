# Structural Evolution demo video script

Target edited runtime: **2:46**, under three minutes. Record the deployed
dashboard, not a raw gate route or JSON page. Start on **SE-6 six-axis cobot**
and use the [natural dialogue](./demo-agent-runbook.md#natural-codex-dialogue).
The runbook owns the agent's exact action sequence; this script owns only the
visible recording and presenter timing.

## Timed storyboard

| Time | Clicks and visible action | Spoken narration | Edit rule |
| --- | --- | --- | --- |
| 0:00–0:10 | Start on deployed **SE-6 six-axis cobot** in **Assemble** with Safety zones off. Orbit once, then open **Review → Agents**. | “Structural Evolution is a browser-native physical-engineering workbench. I begin on this approved SE-6 assembly, where the human and agent share one visible engineering state.” | Real time. Do not move components. |
| 0:10–0:20 | Send the natural setup request. Keep the request, agent activity, and visible assembly switch in frame. | “I ask for the reference drone in ordinary language. The agent selects an approved typed assembly; it does not invent hidden CAD.” | Real time. |
| 0:20–0:39 | Wait for **Reference FPV drone** to appear, then for fresh tool-registration status in **Review → Agents**. Let Codex refetch the tool set. | “A fixture change remounts the workbench, so I wait for the reference-drone tools to re-register and for the agent to refetch them. That prevents an old assembly handle from acting on this new world.” | Real time. This is required visible proof, not quiet-wait footage. |
| 0:39–0:55 | Return to **Assemble**, turn **Safety zones** on, orbit the reference drone around protected geometry and mounted parts, then send the natural continuation request. | “I inspect the safety geometry while the agent waits at the remount boundary. Once the setup looks right, I ask it to find a balanced material reduction and leave the decision to me.” | Real time. Safety zones do not show load vectors here. |
| 0:55–1:25 | The agent inspects the exact revision and starts one balanced candidate. Keep its running status visible. | “From that inspected revision, the agent starts one balanced frame candidate. It is a proposal attached to this assembly, not a change to the accepted design.” | Cut or accelerate only a quiet middle longer than three seconds; label it with this take’s displayed solve time. |
| 1:25–2:08 | The agent enters **Simulate** and visibly steps through hover, roll, pitch, and yaw using Loads, Stress, and Displacement with both geometry views. | “The agent now reviews the candidate across the named flight-load cases. It changes the shared viewport, reads each returned stress and displacement estimate, and identifies the worst case. The moving replay is deterministic assembly motion; it does not re-solve or verify the topology.” | Keep each automatically selected view legible; accelerate only dead time between actions. |
| 2:08–2:34 | After the agent requests human review, pause the final replay. Open **Review → Branches**, then **Evidence**, then **History**. Show the disabled **Use this frame** control. | “The result remains an interactive, unverified estimate. Evidence and history stay attached to its exact revision, while promotion and the final engineering decision remain with me.” | Real time; do not promote, export, compare, or validate. |
| 2:34–2:46 | Return to the topology or worst-case simulation view. | “The complete loop is natural-language intent, live WebMCP engineering actions, visible case review, preserved evidence, and human control.” | Real time. End before 3:00. |

## Director notes

- Use exactly the two natural requests from the runbook. Do not paste tool names
  or choreography into the conversation; the authoritative sequence and stop
  conditions live only in the runbook. The turn boundary is required because
  changing assemblies remounts the page tools.
- The presenter only orbits/rotates the camera and toggles **Safety zones**
  while the agent works. No manual component move, import, geometry edit, or
  layout validation is permitted.
- Static load vectors belong to the Simulate/replay context; motion and changing
  readouts belong to active playback. Keep the unverified/unaccepted label clear.
- If WebMCP is unavailable in the deployed recording browser, stop the live
  claim. Record the visible error; any older deployed take is supporting footage
  only and must be labelled as such.

## Backup shots

- SE-6 opening, then the visible reference-drone assembly generation result.
- The reference-drone **Review → Agents** registration state after remount.
- Safety zones around the reference drone while the camera orbits.
- The unverified estimate, **Branches** with disabled **Use this frame**,
  **Evidence**, and the two applicable **History** receipts.
- Generated topology in Frame only and Full assembly, plus each case layer and
  its truthful replay boundary copy.
