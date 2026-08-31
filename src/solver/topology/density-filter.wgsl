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
@group(0) @binding(1) var<storage, read> unused: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn filter_density(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.count) { return; }
  let plane = params.width * params.height;
  let z = index / plane;
  let rest = index - z * plane;
  let y = rest / params.width;
  let x = rest - y * params.width;
  var weighted = 0.0;
  var weights = 0.0;
  let radius = i32(params.radius);
  for (var dz = -radius; dz <= radius; dz += 1) {
    for (var dy = -radius; dy <= radius; dy += 1) {
      for (var dx = -radius; dx <= radius; dx += 1) {
        let sample = vec3<i32>(i32(x) + dx, i32(y) + dy, i32(z) + dz);
        if (any(sample < vec3<i32>(0)) || sample.x >= i32(params.width)
          || sample.y >= i32(params.height) || sample.z >= i32(params.depth)) { continue; }
        let distance = sqrt(f32(dx * dx + dy * dy + dz * dz));
        let weight = max(0.0, f32(params.radius) + 1.0 - distance);
        let source = u32(sample.x) + params.width * (u32(sample.y) + params.height * u32(sample.z));
        weighted += density[source] * weight;
        weights += weight;
      }
    }
  }
  output[index] = clamp(weighted / max(weights, 1.0), 0.0, 1.0);
}
