struct Params {
  count: u32,
  _padding_0: u32,
  _padding_1: u32,
  _padding_2: u32,
}

@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.count) {
    output[id.x] = input[id.x] * input[id.x] + 0.125;
  }
}
