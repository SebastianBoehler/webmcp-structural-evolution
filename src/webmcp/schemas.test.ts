import { expect, test } from "vitest";

import { RunFoundationProbeInputSchema, runInputJsonSchema } from "./schemas";

const revision = "a".repeat(64);

function jsonPatternAccepts(property: "hypothesis" | "prediction", value: string): boolean {
  const schema = runInputJsonSchema.properties[property];
  return value.length >= schema.minLength
    && value.length <= schema.maxLength
    && new RegExp(schema.pattern).test(value);
}

test.each([
  ["Verification stays within budget", true],
  ["FIELD verification stays within budget", true],
  ["The field is lighter after the probe", true],
  ["Visit HTTPS://example.com for verification", false],
  ["Read C:\\secret.txt before verification", false],
  ["function() verifies the field", false],
  ["The geometry becomes stronger", true],
] as const)("keeps JSON Schema and Zod prediction safety in parity for %s", (prediction, expected) => {
  const zodAccepted = RunFoundationProbeInputSchema.safeParse({
    parentRevision: revision,
    variant: "balanced",
    hypothesis: "Exercise the deterministic balanced",
    prediction,
  }).success;

  expect(jsonPatternAccepts("prediction", prediction)).toBe(expected);
  expect(zodAccepted).toBe(expected);
});

test.each([
  ["Exercise the deterministic balanced", true],
  ["Read /tmp/config before probing", false],
  ["```probe```", false],
] as const)("keeps JSON Schema and Zod hypothesis safety in parity for %s", (hypothesis, expected) => {
  const zodAccepted = RunFoundationProbeInputSchema.safeParse({
    parentRevision: revision,
    variant: "balanced",
    hypothesis,
    prediction: "Verification stays within budget",
  }).success;
  expect(jsonPatternAccepts("hypothesis", hypothesis)).toBe(expected);
  expect(zodAccepted).toBe(expected);
});
