import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { CAD_RESOURCE_LIMITS } from "./cad-resource-limits";
import {
  BodyDynamicsPayloadSchema,
  assertBodyDynamicsCoverage,
} from "./body-dynamics-payload";

const body = (bodyId: string, overrides: Record<string, unknown> = {}) => ({
  bodyId,
  brep: { bytes: new Uint8Array([1, 2, 3]) },
  volumeM3: 1,
  centerOfMassM: [0, 0, 0],
  centroidalInertiaUnitDensityKgM2: [
    2, 0.1, 0.2,
    0.1, 3, 0.3,
    0.2, 0.3, 4,
  ],
  ...overrides,
});

describe("per-body exact dynamics payload", () => {
  it("accepts unique code-unit ordered bodies and requires full requested coverage", () => {
    const payload = BodyDynamicsPayloadSchema.parse({ bodies: [body("body-2"), body("body0")] });

    expect(() => assertBodyDynamicsCoverage(payload, ["body0", "body-2"])).not.toThrow();
    expect(() => assertBodyDynamicsCoverage(payload, ["body-2"])).toThrow(/coverage/i);
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("body0"), body("body-2")] }))
      .toThrow(/code-unit order/i);
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("body"), body("body")] }))
      .toThrow(/unique/i);
  });

  it("rejects nonfinite, asymmetric, and non-positive-definite tensors", () => {
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("nan", { volumeM3: Number.NaN })] }))
      .toThrow();
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("asymmetric", {
      centroidalInertiaUnitDensityKgM2: [2, 0.2, 0, 0.1, 3, 0, 0, 0, 4],
    })] })).toThrow(/symmetric/i);
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("indefinite", {
      centroidalInertiaUnitDensityKgM2: [1, 2, 0, 2, 1, 0, 0, 0, 1],
    })] })).toThrow(/positive definite/i);
  });

  it("validates positive-definiteness without overflow or underflow", () => {
    const diagonal = (value: number) => [value, 0, 0, 0, value * 0.75, 0, 0, 0, value * 0.5];
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("huge", {
      centroidalInertiaUnitDensityKgM2: diagonal(Number.MAX_VALUE / 2),
    })] })).not.toThrow();
    const maximum = Number.MAX_VALUE;
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("huge-dense", {
      centroidalInertiaUnitDensityKgM2: [
        maximum / 2, maximum / 4, 0,
        maximum / 4, maximum / 2, 0,
        0, 0, maximum / 2,
      ],
    })] })).not.toThrow();
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("subnormal", {
      centroidalInertiaUnitDensityKgM2: diagonal(Number.MIN_VALUE * 4),
    })] })).not.toThrow();
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("anisotropic", {
      centroidalInertiaUnitDensityKgM2: [1, 0, 0, 0, 1e-13, 0, 0, 0, 1e-13],
    })] })).not.toThrow();
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("subnormal-asymmetric", {
      centroidalInertiaUnitDensityKgM2: [
        Number.MIN_VALUE * 4, Number.MIN_VALUE * 2, 0,
        0, Number.MIN_VALUE * 3, 0,
        0, 0, Number.MIN_VALUE * 2,
      ],
    })] })).toThrow(/symmetric/i);
  });

  it("accepts owned cross-realm bytes and rejects shared, resizable, partial, or aliased backing", () => {
    const crossRealm = runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array;
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("cross-realm", {
      brep: { bytes: crossRealm },
    })] })).not.toThrow();
    const spoofed = new Uint16Array([1]);
    Object.defineProperty(spoofed, Symbol.toStringTag, { value: "Uint8Array" });
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("spoofed", {
      brep: { bytes: spoofed },
    })] })).toThrow(/Uint8Array/i);

    const backing = new ArrayBuffer(4);
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("partial", {
      brep: { bytes: new Uint8Array(backing, 1, 2) },
    })] })).toThrow(/entire backing buffer/i);
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [
      body("body-a", { brep: { bytes: new Uint8Array(backing) } }),
      body("body-b", { brep: { bytes: new Uint8Array(backing) } }),
    ] })).toThrow(/alias/i);
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("shared", {
      brep: { bytes: new Uint8Array(new SharedArrayBuffer(4)) },
    })] })).toThrow(/shared/i);
    const resizable = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer;
    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("resizable", {
      brep: { bytes: new Uint8Array(resizable) },
    })] })).toThrow(/resizable/i);
  });

  it("rejects body-count and total exact-BREP budgets before accepting a payload", () => {
    expect(() => BodyDynamicsPayloadSchema.parse({
      bodies: Array.from(
        { length: CAD_RESOURCE_LIMITS.bodyDynamicsBodies + 1 },
        (_, index) => body(`body-${String(index).padStart(4, "0")}`),
      ),
    })).toThrow(/body dynamics bodies.*limit/i);

    expect(() => BodyDynamicsPayloadSchema.parse({ bodies: [body("oversized", {
      brep: { bytes: new Uint8Array(CAD_RESOURCE_LIMITS.bodyDynamicsBrepBytes + 1) },
    })] })).toThrow(/body dynamics BREP bytes.*limit/i);
  });
});
