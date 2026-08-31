import { expect, it } from "vitest";

import { defineArtifactRecord } from "./artifact-contract";

const digest = (character: string) => character.repeat(64);

it("records canonical mechanism replay bytes as a first-class artifact kind", async () => {
  await expect(defineArtifactRecord({
    kind: "mechanism-replay", sourceRevision: digest("a"),
    producer: { name: "mechanism-worker", version: "1" },
    settingsDigest: digest("b"), contentDigest: digest("c"), units: "m",
    mediaType: "application/vnd.structural-evolution.mechanism-replay-v1+json",
    dependencies: [{ kind: "entity", reference: "study:arm-motion" }],
  })).resolves.toMatchObject({ kind: "mechanism-replay" });
});
