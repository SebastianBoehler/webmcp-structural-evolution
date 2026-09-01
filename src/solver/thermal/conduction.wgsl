struct GridParams {
  dimensions: vec3<u32>,
  count: u32,
  cell_size_m: f32,
  face_area_m2: f32,
  _padding: vec2<u32>,
}

@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<storage, read> active_cells: array<u32>;
@group(0) @binding(2) var<storage, read> fixed: array<u32>;
@group(0) @binding(3) var<storage, read> conductivity: array<f32>;
@group(0) @binding(4) var<storage, read> fixed_temperature: array<f32>;
@group(0) @binding(5) var<storage, read> source_power: array<f32>;
@group(0) @binding(6) var<storage, read_write> rhs_or_input: array<f32>;
@group(0) @binding(7) var<storage, read_write> diagonal_or_output: array<f32>;
@group(0) @binding(8) var<storage, read> operator_diagonal: array<f32>;

fn neighbor(cell: u32, axis: u32, direction: i32) -> i32 {
  let width = params.dimensions.x;
  let plane = width * params.dimensions.y;
  let z = cell / plane;
  let remainder = cell - z * plane;
  let y = remainder / width;
  let x = remainder - y * width;
  var coordinate = x;
  var stride = 1u;
  var extent = params.dimensions.x;
  if (axis == 1u) { coordinate = y; stride = width; extent = params.dimensions.y; }
  if (axis == 2u) { coordinate = z; stride = plane; extent = params.dimensions.z; }
  if (direction < 0 && coordinate == 0u) { return -1; }
  if (direction > 0 && coordinate + 1u >= extent) { return -1; }
  return i32(cell) + direction * i32(stride);
}

fn conductance(cell: u32, adjacent: u32) -> f32 {
  let left = conductivity[cell];
  let right = conductivity[adjacent];
  let harmonic = 2.0 / (1.0 / left + 1.0 / right);
  return harmonic * params.face_area_m2 / params.cell_size_m;
}

@compute @workgroup_size(64)
fn build_system(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.x;
  if (cell >= params.count) { return; }
  if (active_cells[cell] == 0u) {
    rhs_or_input[cell] = 0.0;
    diagonal_or_output[cell] = 1.0;
    return;
  }
  if (fixed[cell] != 0u) {
    rhs_or_input[cell] = 0.0;
    diagonal_or_output[cell] = 1.0;
    return;
  }
  var diagonal = 0.0;
  var value = source_power[cell];
  for (var axis = 0u; axis < 3u; axis += 1u) {
    for (var direction = -1; direction <= 1; direction += 2) {
      let candidate = neighbor(cell, axis, direction);
      if (candidate < 0 || active_cells[u32(candidate)] == 0u) { continue; }
      let g = conductance(cell, u32(candidate));
      diagonal += g;
      if (fixed[u32(candidate)] != 0u) { value += g * fixed_temperature[u32(candidate)]; }
    }
  }
  rhs_or_input[cell] = value;
  diagonal_or_output[cell] = diagonal;
}

@compute @workgroup_size(64)
fn apply_conduction(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.x;
  if (cell >= params.count) { return; }
  if (active_cells[cell] == 0u || fixed[cell] != 0u) {
    diagonal_or_output[cell] = 0.0;
    return;
  }
  var value = operator_diagonal[cell] * rhs_or_input[cell];
  for (var axis = 0u; axis < 3u; axis += 1u) {
    for (var direction = -1; direction <= 1; direction += 2) {
      let candidate = neighbor(cell, axis, direction);
      if (candidate < 0 || active_cells[u32(candidate)] == 0u || fixed[u32(candidate)] != 0u) { continue; }
      value -= conductance(cell, u32(candidate)) * rhs_or_input[u32(candidate)];
    }
  }
  diagonal_or_output[cell] = value;
}
