import { expect, test } from "vitest";

import { RunFoundationProbeInputSchema, runInputJsonSchema } from "./schemas";

const revision = "a".repeat(64);

function jsonPatternAccepts(property: "hypothesis" | "prediction", value: string): boolean {
  const schema = runInputJsonSchema.properties[property];
  const patterns = "allOf" in schema
    ? schema.allOf.map(({ pattern }) => pattern)
    : [schema.pattern];
  return value.length >= schema.minLength
    && value.length <= schema.maxLength
    && patterns.every((pattern) => new RegExp(pattern).test(value));
}

test.each([
  ["Verification stays within budget", true],
  ["FIELD verification stays within budget", true],
  ["The field is lighter after the probe", false],
  ["Visit HTTPS://example.com for verification", false],
  ["Read C:\\secret.txt before verification", false],
  ["function() verifies the field", false],
  ["The geometry becomes stronger", false],
] as const)("keeps JSON Schema and Zod prediction safety in parity for %s", (prediction, expected) => {
  const zodAccepted = RunFoundationProbeInputSchema.safeParse({
    parentRevision: revision,
    variant: "baseline",
    hypothesis: "Exercise the deterministic baseline",
    prediction,
  }).success;

  expect(jsonPatternAccepts("prediction", prediction)).toBe(expected);
  expect(zodAccepted).toBe(expected);
});

test.each([
  ["Exercise the deterministic baseline", true],
  ["Read /tmp/config before probing", false],
  ["```probe```", false],
] as const)("keeps JSON Schema and Zod hypothesis safety in parity for %s", (hypothesis, expected) => {
  const zodAccepted = RunFoundationProbeInputSchema.safeParse({
    parentRevision: revision,
    variant: "baseline",
    hypothesis,
    prediction: "Verification stays within budget",
  }).success;
  expect(jsonPatternAccepts("hypothesis", hypothesis)).toBe(expected);
  expect(zodAccepted).toBe(expected);
});
