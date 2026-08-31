struct Params {
  width: u32,
  height: u32,
  depth: u32,
  radius: u32,
  count: u32,
  move_limit: f32,
  volume_scale: f32,
  max_sensitivity: f32,
};

@group(0) @binding(0) var<storage, read> density: array<f32>;
@group(0) @binding(1) var<storage, read> sensitivity: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn update_density(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.count) { return; }
  let current = density[index];
  let normalized = sensitivity[index] / max(params.max_sensitivity, 1e-30);
  let desired = current * params.volume_scale - params.move_limit * normalized;
  output[index] = clamp(desired, max(0.0, current - params.move_limit), min(1.0, current + params.move_limit));
}
