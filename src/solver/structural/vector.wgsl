struct VectorParams {
  count: u32,
  _padding: u32,
  alpha: f32,
  beta: f32,
}

@group(0) @binding(0) var<uniform> params: VectorParams;
@group(0) @binding(1) var<storage, read> fixed_dofs: array<u32>;
@group(0) @binding(2) var<storage, read> rhs: array<f32>;
@group(0) @binding(3) var<storage, read_write> solution: array<f32>;
@group(0) @binding(4) var<storage, read_write> residual: array<f32>;
@group(0) @binding(5) var<storage, read_write> preconditioned: array<f32>;
@group(0) @binding(6) var<storage, read_write> direction: array<f32>;
@group(0) @binding(7) var<storage, read> product: array<f32>;
@group(0) @binding(8) var<storage, read> diagonal: array<f32>;

@compute @workgroup_size(64)
fn initialize_pcg(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count) { return; }
  solution[id.x] = 0.0;
  let value = select(rhs[id.x], 0.0, fixed_dofs[id.x] != 0u);
  residual[id.x] = value;
  preconditioned[id.x] = value / diagonal[id.x];
  direction[id.x] = preconditioned[id.x];
}

@compute @workgroup_size(64)
fn update_solution_residual(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count || fixed_dofs[id.x] != 0u) { return; }
  solution[id.x] += params.alpha * direction[id.x];
  residual[id.x] -= params.alpha * product[id.x];
}

@compute @workgroup_size(64)
fn recompute_residual(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count) { return; }
  residual[id.x] = select(rhs[id.x] - product[id.x], 0.0, fixed_dofs[id.x] != 0u);
}

@compute @workgroup_size(64)
fn apply_preconditioner(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count) { return; }
  if (fixed_dofs[id.x] != 0u) {
    preconditioned[id.x] = 0.0;
    return;
  }
  preconditioned[id.x] = residual[id.x] / diagonal[id.x];
}

@compute @workgroup_size(64)
fn update_direction(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count) { return; }
  if (fixed_dofs[id.x] != 0u) {
    direction[id.x] = 0.0;
    return;
  }
  direction[id.x] = preconditioned[id.x] + params.beta * direction[id.x];
}

@compute @workgroup_size(64)
fn mask_reactions(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.count) {
    preconditioned[id.x] = select(0.0, product[id.x], fixed_dofs[id.x] != 0u);
  }
}
