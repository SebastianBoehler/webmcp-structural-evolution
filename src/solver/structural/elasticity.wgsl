struct GridParams {
  cells: vec4<u32>,
  nodes: vec4<u32>,
  material: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<storage, read> active_cells: array<u32>;
@group(0) @binding(2) var<storage, read> fixed_dofs: array<u32>;
@group(0) @binding(3) var<storage, read> element_stiffness: array<f32>;
@group(0) @binding(4) var<storage, read> vector_in: array<f32>;
@group(0) @binding(5) var<storage, read_write> vector_out: array<f32>;

fn cell_index(x: u32, y: u32, z: u32) -> u32 {
  return x + params.cells.x * (y + params.cells.y * z);
}

fn node_index(x: u32, y: u32, z: u32) -> u32 {
  return x + params.nodes.x * (y + params.nodes.y * z);
}

fn gather_row(dof: u32, diagonal_only: bool) -> f32 {
  let node = dof / 3u;
  let axis = dof % 3u;
  let nz = node / (params.nodes.x * params.nodes.y);
  let rest = node - nz * params.nodes.x * params.nodes.y;
  let ny = rest / params.nodes.x;
  let nx = rest - ny * params.nodes.x;
  var sum = 0.0;
  for (var lz = 0u; lz < 2u; lz += 1u) {
    if (nz < lz) { continue; }
    let cz = nz - lz;
    if (cz >= params.cells.z) { continue; }
    for (var ly = 0u; ly < 2u; ly += 1u) {
      if (ny < ly) { continue; }
      let cy = ny - ly;
      if (cy >= params.cells.y) { continue; }
      for (var lx = 0u; lx < 2u; lx += 1u) {
        if (nx < lx) { continue; }
        let cx = nx - lx;
        if (cx >= params.cells.x || active_cells[cell_index(cx, cy, cz)] == 0u) { continue; }
        let local_row = (lx + 2u * ly + 4u * lz) * 3u + axis;
        if (diagonal_only) {
          sum += element_stiffness[local_row * 24u + local_row];
          continue;
        }
        for (var local_node = 0u; local_node < 8u; local_node += 1u) {
          let ox = local_node & 1u;
          let oy = (local_node >> 1u) & 1u;
          let oz = (local_node >> 2u) & 1u;
          let global_node = node_index(cx + ox, cy + oy, cz + oz);
          for (var component = 0u; component < 3u; component += 1u) {
            let local_column = local_node * 3u + component;
            sum += element_stiffness[local_row * 24u + local_column]
              * vector_in[global_node * 3u + component];
          }
        }
      }
    }
  }
  return sum;
}

@compute @workgroup_size(64)
fn apply_elasticity(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.nodes.w) { vector_out[id.x] = gather_row(id.x, false); }
}

@compute @workgroup_size(64)
fn build_diagonal(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.nodes.w) { return; }
  vector_out[id.x] = select(max(gather_row(id.x, true), 1e-20), 1.0, fixed_dofs[id.x] != 0u);
}

fn center_gradient(local_node: u32) -> vec3<f32> {
  let sx = select(-1.0, 1.0, (local_node & 1u) != 0u);
  let sy = select(-1.0, 1.0, ((local_node >> 1u) & 1u) != 0u);
  let sz = select(-1.0, 1.0, ((local_node >> 2u) & 1u) != 0u);
  return vec3<f32>(sx, sy, sz) / (4.0 * params.material.z);
}

@compute @workgroup_size(64)
fn compute_stress(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.cells.w) { return; }
  if (active_cells[id.x] == 0u) { vector_out[id.x] = 0.0; return; }
  let cz = id.x / (params.cells.x * params.cells.y);
  let rest = id.x - cz * params.cells.x * params.cells.y;
  let cy = rest / params.cells.x;
  let cx = rest - cy * params.cells.x;
  var exx = 0.0; var eyy = 0.0; var ezz = 0.0;
  var gxy = 0.0; var gyz = 0.0; var gxz = 0.0;
  for (var local = 0u; local < 8u; local += 1u) {
    let gradient = center_gradient(local);
    let node = node_index(cx + (local & 1u), cy + ((local >> 1u) & 1u), cz + ((local >> 2u) & 1u));
    let u = vec3<f32>(vector_in[node * 3u], vector_in[node * 3u + 1u], vector_in[node * 3u + 2u]);
    exx += gradient.x * u.x; eyy += gradient.y * u.y; ezz += gradient.z * u.z;
    gxy += gradient.y * u.x + gradient.x * u.y;
    gyz += gradient.z * u.y + gradient.y * u.z;
    gxz += gradient.z * u.x + gradient.x * u.z;
  }
  let lambda = params.material.x;
  let mu = params.material.y;
  let trace = exx + eyy + ezz;
  let normal = vec3<f32>(lambda * trace) + 2.0 * mu * vec3<f32>(exx, eyy, ezz);
  let shear = mu * vec3<f32>(gxy, gyz, gxz);
  let difference = (normal.x - normal.y) * (normal.x - normal.y)
    + (normal.y - normal.z) * (normal.y - normal.z)
    + (normal.z - normal.x) * (normal.z - normal.x);
  vector_out[id.x] = sqrt(0.5 * difference + 3.0 * dot(shear, shear));
}
