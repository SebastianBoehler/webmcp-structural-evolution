# Structural and topology live browser gate

Open the isolated local route:

```text
http://127.0.0.1:5174/?structural-topology-gate=1
```

The route loads before the legacy workbench and does not construct the Three.js/WebGL viewer. It rebuilds exact OCCT BREP and semantic mesh outputs for every case, derives a bounded exact-BREP-authoritative voxel domain, and runs the production WebGPU structural/topology adapters. A serialized report is audit evidence only; it never authorizes manufacturing. A successful session keeps the exact drone and cobot meshes in a private capability-bound store, and only that capability can serialize either captured mesh.

## Locked cases and checks

- Axial bar: `0.1 × 0.01 × 0.01 m`, `h=0.005 m`, `F=1000 N`, `20 × 2 × 2`, `E=70 GPa`.
- Cantilever: `0.12 × 0.02 × 0.01 m`, `h=0.005 m`, `F=100 N`, `24 × 4 × 2`, `E=70 GPa`.
- Drone: an arm/root union with a revision-owned `0.75` target volume fraction.
- Cobot: a distinct `0.10 × 0.03 × 0.02 m` web/shoulder/elbow upper-arm union, `1000 N` transverse load, and revision-owned `0.75` target volume fraction. The `20 mm` extrusion is locked independently from the unchanged load and acceptance limits.
- Structural evidence separates the WebGPU PCG recurrence residual, recomputed same-f32-operator residual diagnostic, raw GPU reaction diagnostic, independent Wasm solve L2, and f64-on-GPU-field reaction/energy evidence.
- Topology must remove material to its exact target, keep required interfaces connected, extract a closed oriented mesh, rerasterize to the same final mask, and pass post-extraction structural and configured acceptance checks.
- In-flight cancellation must commit no artifacts, emit one terminal, remain quiescent, and recover on a fresh run.
- Every actual solve acquisition must report the same adapter identity, sorted features, required limits, clean error scopes, no uncaptured GPU errors, and no unexpected device loss.

## Current measured status

PASS in the in-app browser at the `5174` route above. The sealed report session begins `341f0823` and ends `9237`; total measured time was `45.373 s`. The device reported Apple/Metal 3, 14 solve acquisitions with one matching identity, `268435456` byte maximum buffer size, `134217728` byte maximum storage binding, `65535` workgroups per dimension, and `256` invocations per workgroup.

- Axial: `37` total GPU iterations, recurrence residual `4.148456032454094e-6`, mean loaded-end relative error `0.009463494483497946`, f64 balance `0.007864920546388428 N`, and energy mismatch `5.067923075086802e-6`.
- Cantilever: `714` total GPU iterations including bounded mixed-precision correction, recurrence residual `9.592105756955175e-6`, mean loaded-end relative error `0.025315128726364204`, f64 balance `0.00011550609032645507 N`, independent-solve L2 `2.5594567887310404e-6`, and energy mismatch `7.033835050293422e-7`.
- Drone topology: `96 → 72` active cells, exact `0.75` material fraction, exact reraster match, `30,496,214 Pa` maximum stress, safety factor `8.197738906213079`, and `0.0003090982029535065 m` maximum displacement.
- Cobot topology: `256 → 192` active cells, exact `0.75` material fraction, exact reraster match, `130,575,024 Pa` maximum stress, safety factor `1.914608110659815`, and `0.0021946943996873822 m` maximum displacement. Locked limits remained `150,000,000 Pa`, `1.5`, and `0.03 m`.
- Cancellation produced one cancelled terminal, committed zero artifacts, remained quiescent, and a fresh recovery solve passed.
- The closure-bound capability rederived each manufacturing artifact from the privately captured mesh bytes and serialized `18,484` drone STL bytes and `30,684` cobot STL bytes. The serializable report remains audit-only and does not authorize manufacturing.

The sealed run recorded `0` console warnings and `0` console errors, with clean GPU error scopes, zero uncaptured GPU errors, and no unexpected device loss. Any earlier browser log entries from fail-closed diagnostic runs are historical and are not part of this sealed session.
