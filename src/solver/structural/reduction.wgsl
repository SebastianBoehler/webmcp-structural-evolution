struct ReductionParams {
  count: u32,
  stride: u32,
  offset: u32,
  _padding: u32,
}

@group(0) @binding(0) var<uniform> params: ReductionParams;
@group(0) @binding(1) var<storage, read> left: array<f32>;
@group(0) @binding(2) var<storage, read> right: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
var<workgroup> scratch: array<f32, 64>;

fn finish_reduction(local: u32, group: u32) {
  workgroupBarrier();
  var width = 32u;
  while (width > 0u) {
    if (local < width) { scratch[local] += scratch[local + width]; }
    workgroupBarrier();
    width /= 2u;
  }
  if (local == 0u) { output[group] = scratch[0]; }
}

@compute @workgroup_size(64)
fn dot_product(
  @builtin(global_invocation_id) global: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
) {
  scratch[local.x] = 0.0;
  if (global.x < params.count) { scratch[local.x] = left[global.x] * right[global.x]; }
  finish_reduction(local.x, group.x);
}

@compute @workgroup_size(64)
fn reduce_sum(
  @builtin(global_invocation_id) global: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
) {
  scratch[local.x] = 0.0;
  if (global.x < params.count) { scratch[local.x] = left[global.x]; }
  finish_reduction(local.x, group.x);
}

@compute @workgroup_size(64)
fn sum_strided(
  @builtin(global_invocation_id) global: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
) {
  scratch[local.x] = 0.0;
  if (global.x < params.count) {
    scratch[local.x] = left[params.offset + global.x * params.stride];
  }
  finish_reduction(local.x, group.x);
}
