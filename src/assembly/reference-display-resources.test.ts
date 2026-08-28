import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { REFERENCE_DRONE_CATALOG } from "../samples/reference-drone-catalog";
import { REFERENCE_DISPLAY_RESOURCES } from "./reference-display-resources";

describe("reference display resources", () => {
  it("gives every sourced physical product a detailed local render asset", () => {
    const products = REFERENCE_DRONE_CATALOG.filter(({ manufacturer, massAccounting }) =>
      manufacturer !== "Sunderlabs" && massAccounting === "standalone");

    for (const product of products) {
      const resource = REFERENCE_DISPLAY_RESOURCES[product.revision];
      expect(resource, product.id).toBeDefined();
      expect(existsSync(resolve("public", resource!.assetUrl.replace(/^\//, ""))), product.id).toBe(true);
      expect(resource!.validation, product.id).toBe("manufacturer-dimensions");
    }
  });
});
