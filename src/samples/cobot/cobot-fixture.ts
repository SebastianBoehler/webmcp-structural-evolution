import { createAssemblyAuthoringState } from "../../assembly/assembly-authoring";
import { freezeSnapshot } from "../../domain/design";
import type { ContextSelection } from "../../domain/foundation-context";
import { createFoundationContext } from "../foundation-context";
import { SE6_INVENTORY, se6Assembly } from "./cobot-assembly";
import { SE6_CATALOG } from "./cobot-catalog";
import { se6Study } from "./cobot-study";
import { renderSe6Assembly } from "./cobot-visuals";

const workspace = await createAssemblyAuthoringState(se6Assembly, SE6_CATALOG);
const selection: ContextSelection = {
  id: "se6-upper-arm-design-domain",
  label: "SE-6 solver-owned upper arm",
  min: [0, 0, 0], maxExclusive: [48, 24, 16],
};
const context = createFoundationContext({
  assembly: se6Assembly,
  inventory: SE6_INVENTORY,
  study: se6Study,
  selection,
});

export const SE6_COBOT_FIXTURE = freezeSnapshot({
  id: "se6-cobot",
  label: "SE-6 six-axis cobot",
  components: SE6_CATALOG,
  inventory: SE6_INVENTORY,
  assembly: se6Assembly,
  study: se6Study,
  workspace,
  context,
  renderParts: renderSe6Assembly,
});
