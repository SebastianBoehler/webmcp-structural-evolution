# Manufacturing-Grade Structural Evolution Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap plan-by-plan. Each linked plan contains checkbox (`- [ ]`) tasks and verification gates.

**Goal:** Replace the foundation demo with a defensible agentic CAD/CAE workflow that creates a realistic PA12 5-inch drone assembly, optimizes it under physical loads, independently verifies it, and prepares a printable 3MF package.

**Architecture:** Immutable typed design revisions connect component ingestion, assembly authoring, WebGPU optimization, independent Rust/Wasm verification, manufacturing reconstruction, CAD visualization, and WebMCP collaboration. Each phase has an evidence gate and no later phase may silently compensate for an earlier failure.

**Specs:**
- `docs/superpowers/specs/2026-08-26-agent-authored-component-ingestion.md`
- `docs/superpowers/specs/2026-08-26-manufacturing-grade-drone-topology-design.md`

## Execution order

1. `2026-08-26-agent-authored-assembly.md`
   - Typed component packages and bounded parametric geometry.
   - Realistic, traceable motor, avionics, battery, fastener, cable, and propeller-envelope catalog.
2. `2026-08-26-assembly-authoring-webmcp.md`
   - Constraint-based assembly editing and conflicts.
   - Blender-inspired inspect → preview → apply WebMCP actions without arbitrary code.
3. `2026-08-26-physical-reference-solver.md`
   - SI study contracts and independent Rust Hex8/matrix-free elasticity core.
4. `2026-08-26-flight-verification-wasm.md`
   - Inertia relief, stress, modes, Wasm evidence, and exact PA12 FPV study.
5. `2026-08-26-webgpu-physical-topology.md`
   - Interactive WebGPU FEM, multigrid PCG, SIMP/MMA, modal constraints, and progressive runs.
6. `2026-08-26-manufacturing-pipeline.md`
   - Surface reconstruction, interfaces/voids, revoxelized verification, SLS/MJF checks, and 3MF export.
7. `2026-08-26-engineering-ux-webmcp.md`
   - CAD controls, force/result visualization, human-readable evidence, study tools, and full browser/eval gate.

## Non-negotiable release gates

- Imported or authored component geometry has explicit provenance, units, interfaces, collision geometry, and protected envelopes.
- The reference frame is connected to real motor mounts and avionics interfaces; no floating material or decorative load paths.
- WebGPU and independently authored Rust/Wasm analyses agree at locked physical tolerances.
- Whole-frame flight equilibrates force and moment through inertia relief; impact cases remain clearly equivalent-static.
- Optimizer convergence, hard-bound satisfaction, extraction deviation, post-extraction verification, and process checks are all separately visible.
- The final package contains unit-preserving 3MF, compatibility STL, BOM, assumptions, sources, hashes, and a validation report.
- An agent can inspect, preview, edit, plan, optimize, compare, and verify through typed WebMCP tools; it cannot run arbitrary code, fetch arbitrary URLs, purchase parts, promote a branch, or download an export.
- A judge can understand the product, novelty, governing result, and human-agent interaction in the first minute without opening raw diagnostics.

## Completion check

Run `pnpm check`, the browser-specific WebGPU suite, official WebMCP smoke/selection evals, the full in-app-browser journey, and deterministic 3MF inspection. Record unavailable APIs or backends as unverified rather than passed. Commit each task independently using the messages in the linked plans, then push `main` only after the complete current gate is green.
