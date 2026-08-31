struct Params {
  cells: vec4<u32>,
  nodes: vec4<u32>,
  update: vec4<f32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> density: array<f32>;
@group(0) @binding(2) var<storage, read> design_domain: array<u32>;
@group(0) @binding(3) var<storage, read> displacement: array<f32>;
@group(0) @binding(4) var<storage, read> stiffness: array<f32>;
@group(0) @binding(5) var<storage, read_write> element_energy: array<f32>;
@group(0) @binding(6) var<storage, read> descent_direction: array<f32>;
@group(0) @binding(7) var<storage, read_write> output: array<f32>;

fn node_index(x: u32, y: u32, z: u32) -> u32 {
  return x + params.nodes.x * (y + params.nodes.y * z);
}

@compute @workgroup_size(64)
fn compute_compliance_sensitivity(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.cells.w) { return; }
  if (design_domain[index] == 0u) { element_energy[index] = 0.0; return; }
  let z = index / (params.cells.x * params.cells.y);
  let rest = index - z * params.cells.x * params.cells.y;
  let y = rest / params.cells.x;
  let x = rest - y * params.cells.x;
  var energy = 0.0;
  for (var row = 0u; row < 24u; row += 1u) {
    let row_node = row / 3u;
    let row_global = node_index(
      x + (row_node & 1u), y + ((row_node >> 1u) & 1u), z + ((row_node >> 2u) & 1u),
    ) * 3u + row % 3u;
    var applied = 0.0;
    for (var column = 0u; column < 24u; column += 1u) {
      let column_node = column / 3u;
      let column_global = node_index(
        x + (column_node & 1u), y + ((column_node >> 1u) & 1u), z + ((column_node >> 2u) & 1u),
      ) * 3u + column % 3u;
      applied += stiffness[row * 24u + column] * displacement[column_global];
    }
    energy += displacement[row_global] * applied;
  }
  element_energy[index] = max(0.0, 0.5 * energy);
}

@compute @workgroup_size(64)
fn update_density(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.cells.w) { return; }
  if (design_domain[index] == 0u) { output[index] = 0.0; return; }
  let current = density[index];
  let move_limit = params.update.x;
  let desired = current + move_limit * descent_direction[index];
  output[index] = clamp(desired, max(0.0, current - move_limit), min(1.0, current + move_limit));
}
