struct VectorParams {
  count: u32,
  _padding: u32,
  source_scale: f32,
  target_scale: f32,
}

@group(0) @binding(0) var<uniform> params: VectorParams;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> target_values: array<f32>;
@group(0) @binding(3) var<storage, read> diagonal: array<f32>;
@group(0) @binding(4) var<storage, read> fixed: array<u32>;
@group(0) @binding(5) var<storage, read> fixed_temperature: array<f32>;

@compute @workgroup_size(64)
fn initialize_pcg(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.count) {
    target_values[id.x] = select(0.0, fixed_temperature[id.x], fixed[id.x] != 0u);
  }
}

@compute @workgroup_size(64)
fn copy_vector(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.count) { target_values[id.x] = source[id.x]; }
}

@compute @workgroup_size(64)
fn apply_preconditioner(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.count) { target_values[id.x] = source[id.x] / diagonal[id.x]; }
}

@compute @workgroup_size(64)
fn axpy(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.count) {
    target_values[id.x] = params.target_scale * target_values[id.x] + params.source_scale * source[id.x];
  }
}

@compute @workgroup_size(64)
fn add_offset(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.count) { target_values[id.x] += params.source_scale; }
}
