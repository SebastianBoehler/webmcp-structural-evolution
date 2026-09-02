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
@group(0) @binding(8) var<storage, read> block_diagonal: array<f32>;
@group(0) @binding(9) var<storage, read_write> solution_compensation: array<f32>;

fn block_precondition(node: u32, value: vec3<f32>) -> vec3<f32> {
  let offset = node * 9u;
  let first = vec3<f32>(block_diagonal[offset], block_diagonal[offset + 1u], block_diagonal[offset + 2u]);
  let second = vec3<f32>(block_diagonal[offset + 3u], block_diagonal[offset + 4u], block_diagonal[offset + 5u]);
  let third = vec3<f32>(block_diagonal[offset + 6u], block_diagonal[offset + 7u], block_diagonal[offset + 8u]);
  let scale = max(max(max(abs(first.x), abs(first.y)), max(abs(first.z), abs(second.x))),
    max(max(abs(second.y), abs(second.z)), max(max(abs(third.x), abs(third.y)), abs(third.z))));
  if (scale <= 1e-20) { return value; }
  let a = first / scale;
  let b = second / scale;
  let c = third / scale;
  let determinant = dot(a, cross(b, c));
  let normalized = value / scale;
  if (abs(determinant) <= 1e-12) {
    return vec3<f32>(
      value.x / max(abs(first.x), 1e-20),
      value.y / max(abs(second.y), 1e-20),
      value.z / max(abs(third.z), 1e-20),
    );
  }
  return vec3<f32>(
    dot(normalized, cross(b, c)),
    dot(normalized, cross(c, a)),
    dot(normalized, cross(a, b)),
  ) / determinant;
}

@compute @workgroup_size(64)
fn initialize_pcg(@builtin(global_invocation_id) id: vec3<u32>) {
  let offset = id.x * 3u;
  if (offset >= params.count) { return; }
  let value = vec3<f32>(
    select(rhs[offset], 0.0, fixed_dofs[offset] != 0u),
    select(rhs[offset + 1u], 0.0, fixed_dofs[offset + 1u] != 0u),
    select(rhs[offset + 2u], 0.0, fixed_dofs[offset + 2u] != 0u),
  );
  let conditioned = block_precondition(id.x, value);
  for (var axis = 0u; axis < 3u; axis += 1u) {
    solution[offset + axis] = 0.0;
    solution_compensation[offset + axis] = 0.0;
    residual[offset + axis] = value[axis];
    preconditioned[offset + axis] = conditioned[axis];
    direction[offset + axis] = conditioned[axis];
  }
}

@compute @workgroup_size(64)
fn update_solution_residual(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count || fixed_dofs[id.x] != 0u) { return; }
  let increment = params.alpha * direction[id.x];
  let corrected = increment - solution_compensation[id.x];
  let next = solution[id.x] + corrected;
  solution_compensation[id.x] = (next - solution[id.x]) - corrected;
  solution[id.x] = next;
  residual[id.x] -= params.alpha * product[id.x];
}

@compute @workgroup_size(64)
fn recompute_residual(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count) { return; }
  residual[id.x] = select(rhs[id.x] - product[id.x], 0.0, fixed_dofs[id.x] != 0u);
}

@compute @workgroup_size(64)
fn apply_preconditioner(@builtin(global_invocation_id) id: vec3<u32>) {
  let offset = id.x * 3u;
  if (offset >= params.count) { return; }
  let conditioned = block_precondition(id.x, vec3<f32>(
    residual[offset], residual[offset + 1u], residual[offset + 2u],
  ));
  for (var axis = 0u; axis < 3u; axis += 1u) {
    preconditioned[offset + axis] = select(conditioned[axis], 0.0, fixed_dofs[offset + axis] != 0u);
  }
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
