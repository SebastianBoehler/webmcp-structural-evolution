use super::structural::{validate, StructuralReferenceInput};
use super::structural_element::{apply, stiffness, von_mises};

pub(super) struct StructuralFieldEvaluation {
    pub reaction_n: [f64; 3],
    pub von_mises_stress_pa: Vec<f32>,
    pub force_balance_error_n: f64,
    pub compliance_j: f64,
    pub strain_energy_j: f64,
    pub energy_relative_mismatch: f64,
    pub direct_relative_residual: f64,
}

pub(super) struct StructuralIterateEvaluation {
    pub free_residual_n: Vec<f64>,
}

struct EvaluatedDisplacement {
    product: Vec<f64>,
    reaction_n: [f64; 3],
    force_balance_error_n: f64,
    compliance_j: f64,
    strain_energy_j: f64,
    energy_relative_mismatch: f64,
    direct_relative_residual: f64,
}

fn evaluate_f64(
    input: &StructuralReferenceInput,
    displacement: &[f64],
) -> Result<EvaluatedDisplacement, String> {
    validate(input)?;
    if displacement.len() != input.loads_n.len()
        || displacement.iter().any(|value| !value.is_finite()) {
        return Err("invalid structural displacement field".into());
    }
    if displacement.iter().zip(&input.fixed_dofs)
        .any(|(value, fixed)| *fixed != 0 && *value != 0.0) {
        return Err("structural displacement field violates a fixed degree of freedom".into());
    }
    let ke = stiffness(input);
    let mut product = vec![0.0; displacement.len()];
    apply(input, &ke, displacement, &mut product);
    let mut reaction_n = [0.0; 3];
    for (dof, fixed) in input.fixed_dofs.iter().copied().enumerate() {
        if fixed != 0 { reaction_n[dof % 3] += product[dof]; }
    }
    let mut balance = reaction_n;
    for (dof, load) in input.loads_n.iter().enumerate() { balance[dof % 3] += load; }
    let compliance_j = input.loads_n.iter().zip(displacement).map(|(load, x)| load * x).sum::<f64>();
    let strain_energy_j = 0.5 * product.iter().zip(displacement).map(|(kx, x)| kx * x).sum::<f64>();
    let energy_relative_mismatch = (compliance_j - 2.0 * strain_energy_j).abs()
        / compliance_j.abs().max(f64::EPSILON);
    let force_balance_error_n = balance.iter().map(|value| value * value).sum::<f64>().sqrt();
    let (residual_squared, rhs_squared) = input.loads_n.iter().zip(&product).zip(&input.fixed_dofs)
        .filter(|(_, fixed)| **fixed == 0)
        .fold((0.0, 0.0), |(residual_sum, rhs_sum), ((load, product), _)| {
            (residual_sum + (load - product).powi(2), rhs_sum + load.powi(2))
        });
    let direct_relative_residual = residual_squared.sqrt() / rhs_squared.sqrt().max(f64::EPSILON);
    if ![force_balance_error_n, compliance_j, strain_energy_j, energy_relative_mismatch,
        direct_relative_residual]
        .iter().all(|value| value.is_finite()) {
        return Err("structural field evaluation is non-finite".into());
    }
    Ok(EvaluatedDisplacement {
        product, reaction_n, force_balance_error_n, compliance_j,
        strain_energy_j, energy_relative_mismatch, direct_relative_residual,
    })
}

pub(super) fn evaluate_structural_field(
    input: &StructuralReferenceInput,
    displacement_m: &[f32],
) -> Result<StructuralFieldEvaluation, String> {
    let displacement: Vec<f64> = displacement_m.iter().map(|value| f64::from(*value)).collect();
    let evaluated = evaluate_f64(input, &displacement)?;
    let von_mises_stress_pa = von_mises(input, &displacement);
    Ok(StructuralFieldEvaluation {
        reaction_n: evaluated.reaction_n, von_mises_stress_pa,
        force_balance_error_n: evaluated.force_balance_error_n,
        compliance_j: evaluated.compliance_j, strain_energy_j: evaluated.strain_energy_j,
        energy_relative_mismatch: evaluated.energy_relative_mismatch,
        direct_relative_residual: evaluated.direct_relative_residual,
    })
}

pub(super) fn evaluate_structural_iterate_f64(
    input: &StructuralReferenceInput,
    displacement_m: &[f64],
) -> Result<StructuralIterateEvaluation, String> {
    let evaluated = evaluate_f64(input, displacement_m)?;
    let free_residual_n = input.loads_n.iter().zip(&evaluated.product).zip(&input.fixed_dofs)
        .map(|((load, product), fixed)| if *fixed == 0 { load - product } else { 0.0 })
        .collect();
    Ok(StructuralIterateEvaluation {
        free_residual_n,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::topology::structural::{cantilever_fixture, solve_reference};

    #[test]
    fn evaluates_cast_cantilever_balance_and_energy() {
        let fixture = cantilever_fixture();
        let solved = solve_reference(&fixture.input).unwrap();
        let result = evaluate_structural_field(&fixture.input, &solved.displacement_m).unwrap();
        assert!(result.force_balance_error_n < 1.0e-4);
        assert!(result.energy_relative_mismatch < 1.0e-5);
        assert!(result.direct_relative_residual.is_finite());
        assert_eq!(result.von_mises_stress_pa.len(), fixture.input.active_cells.len());
    }

    #[test]
    fn exposes_perturbed_field_as_inconsistent() {
        let fixture = cantilever_fixture();
        let mut field = solve_reference(&fixture.input).unwrap().displacement_m;
        let free = fixture.input.fixed_dofs.iter().position(|value| *value == 0).unwrap();
        field[free] += 1.0e-4;
        let result = evaluate_structural_field(&fixture.input, &field).unwrap();
        assert!(result.energy_relative_mismatch > 1.0e-5);
    }

    #[test]
    fn rejects_wrong_length_and_nonfinite_fields() {
        let fixture = cantilever_fixture();
        assert!(evaluate_structural_field(&fixture.input, &[0.0]).is_err());
        let mut field = vec![0.0; fixture.input.loads_n.len()];
        field[0] = f32::NAN;
        assert!(evaluate_structural_field(&fixture.input, &field).is_err());
    }

    #[test]
    fn rejects_nonzero_fixed_degree_of_freedom() {
        let fixture = cantilever_fixture();
        let mut field = vec![0.0; fixture.input.loads_n.len()];
        let fixed = fixture.input.fixed_dofs.iter().position(|value| *value != 0).unwrap();
        field[fixed] = 1.0e-6;
        assert!(evaluate_structural_field(&fixture.input, &field).is_err());
    }

    #[test]
    fn evaluates_canonical_free_residual_for_f64_master_iterate() {
        let fixture = cantilever_fixture();
        let solved = solve_reference(&fixture.input).unwrap();
        let mut master = solved.displacement_m.iter().map(|value| f64::from(*value)).collect::<Vec<_>>();
        let free = fixture.input.fixed_dofs.iter().position(|value| *value == 0).unwrap();
        master[free] += 1.0e-4;

        let result = evaluate_structural_iterate_f64(&fixture.input, &master).unwrap();

        assert_eq!(result.free_residual_n.len(), fixture.input.loads_n.len());
        assert!(result.free_residual_n[free].abs() > 1.0);
        assert!(result.free_residual_n.iter().zip(&fixture.input.fixed_dofs)
            .all(|(residual, fixed)| *fixed == 0 || *residual == 0.0));
    }
}
