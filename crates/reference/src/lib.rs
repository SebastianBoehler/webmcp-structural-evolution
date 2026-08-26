use std::fmt;

use wasm_bindgen::prelude::*;

pub mod topology;

#[derive(Debug, PartialEq, Eq)]
pub enum RelativeL2Error {
    EmptyInput,
    LengthMismatch { expected: usize, actual: usize },
    NonFiniteInput { vector: &'static str, index: usize },
    ZeroDenominator,
    ResultOutOfRange,
    ResultUnderflow,
}

impl RelativeL2Error {
    fn code(&self) -> &'static str {
        match self {
            Self::EmptyInput => "empty-input",
            Self::LengthMismatch { .. } => "length-mismatch",
            Self::NonFiniteInput { .. } => "non-finite-input",
            Self::ZeroDenominator => "zero-denominator",
            Self::ResultOutOfRange => "result-out-of-range",
            Self::ResultUnderflow => "result-underflow",
        }
    }
}

impl fmt::Display for RelativeL2Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "[{}] ", self.code())?;
        match self {
            Self::EmptyInput => write!(formatter, "expected and actual vectors must not be empty"),
            Self::LengthMismatch { expected, actual } => write!(
                formatter,
                "vector lengths differ: expected {expected}, actual {actual}"
            ),
            Self::NonFiniteInput { vector, index } => {
                write!(formatter, "{vector}[{index}] is not finite")
            }
            Self::ZeroDenominator => {
                write!(
                    formatter,
                    "expected vector L2 norm is zero, so the ratio is undefined"
                )
            }
            Self::ResultOutOfRange => write!(
                formatter,
                "relative L2 result cannot be represented as a finite f32"
            ),
            Self::ResultUnderflow => write!(
                formatter,
                "nonzero relative L2 result rounds to zero as f32"
            ),
        }
    }
}

pub fn relative_l2_core(expected: &[f32], actual: &[f32]) -> Result<f32, RelativeL2Error> {
    if expected.is_empty() || actual.is_empty() {
        return Err(RelativeL2Error::EmptyInput);
    }
    if expected.len() != actual.len() {
        return Err(RelativeL2Error::LengthMismatch {
            expected: expected.len(),
            actual: actual.len(),
        });
    }

    let mut numerator_squared = 0.0_f64;
    let mut denominator_squared = 0.0_f64;
    for (index, (&expected_value, &actual_value)) in expected.iter().zip(actual).enumerate() {
        if !expected_value.is_finite() {
            return Err(RelativeL2Error::NonFiniteInput {
                vector: "expected",
                index,
            });
        }
        if !actual_value.is_finite() {
            return Err(RelativeL2Error::NonFiniteInput {
                vector: "actual",
                index,
            });
        }

        let expected_f64 = f64::from(expected_value);
        let difference = expected_f64 - f64::from(actual_value);
        numerator_squared = difference.mul_add(difference, numerator_squared);
        denominator_squared = expected_f64.mul_add(expected_f64, denominator_squared);
    }

    if !numerator_squared.is_finite() || !denominator_squared.is_finite() {
        return Err(RelativeL2Error::ResultOutOfRange);
    }
    if denominator_squared == 0.0 {
        return Err(RelativeL2Error::ZeroDenominator);
    }

    let result = numerator_squared.sqrt() / denominator_squared.sqrt();
    if !result.is_finite() || result > f64::from(f32::MAX) {
        return Err(RelativeL2Error::ResultOutOfRange);
    }

    let result_f32 = result as f32;
    if result != 0.0 && result_f32 == 0.0 {
        return Err(RelativeL2Error::ResultUnderflow);
    }

    Ok(result_f32)
}

fn relative_l2_error(error: RelativeL2Error) -> JsValue {
    let js_error = js_sys::Error::new(&error.to_string());
    js_error.set_name("RelativeL2Error");
    js_sys::Reflect::set(
        js_error.as_ref(),
        &JsValue::from_str("code"),
        &JsValue::from_str(error.code()),
    )
    .expect("a new JavaScript Error must accept the structured error code");
    js_error.into()
}

#[wasm_bindgen]
pub fn relative_l2(expected: &[f32], actual: &[f32]) -> Result<f32, JsValue> {
    relative_l2_core(expected, actual).map_err(relative_l2_error)
}

#[cfg(test)]
mod tests {
    use super::relative_l2_core;

    #[test]
    fn exact_nonzero_vectors_have_zero_error() {
        assert_eq!(relative_l2_core(&[1.0, -2.0], &[1.0, -2.0]), Ok(0.0));
    }

    #[test]
    fn known_vectors_have_expected_relative_error() {
        let result = relative_l2_core(&[1.0, 2.0], &[2.0, 3.0]).unwrap();
        let expected = (2.0_f32 / 5.0).sqrt();

        assert!((result - expected).abs() < 1e-6);
    }

    #[test]
    fn unequal_lengths_are_rejected() {
        let error = relative_l2_core(&[1.0], &[1.0, 2.0]).unwrap_err();

        assert!(error.to_string().contains("length-mismatch"));
    }

    #[test]
    fn empty_vectors_are_rejected() {
        let error = relative_l2_core(&[], &[]).unwrap_err();

        assert!(error.to_string().contains("empty-input"));
    }

    #[test]
    fn non_finite_values_in_either_vector_are_rejected() {
        for (expected, actual) in [
            (vec![f32::NAN], vec![1.0]),
            (vec![f32::INFINITY], vec![1.0]),
            (vec![1.0], vec![f32::NEG_INFINITY]),
        ] {
            let error = relative_l2_core(&expected, &actual).unwrap_err();
            assert!(error.to_string().contains("non-finite-input"));
        }
    }

    #[test]
    fn zero_denominator_is_an_error_even_for_equal_vectors() {
        for actual in [&[0.0, 0.0][..], &[0.0, 1.0][..]] {
            let error = relative_l2_core(&[0.0, 0.0], actual).unwrap_err();
            assert!(error.to_string().contains("zero-denominator"));
        }
    }

    #[test]
    fn result_must_be_representable_as_a_finite_f32() {
        let error = relative_l2_core(&[f32::MIN_POSITIVE], &[f32::MAX]).unwrap_err();

        assert!(error.to_string().contains("result-out-of-range"));
    }

    #[test]
    fn nonzero_result_that_underflows_f32_is_rejected() {
        let error = relative_l2_core(&[f32::MAX, f32::MIN_POSITIVE], &[f32::MAX, 0.0]).unwrap_err();

        assert!(error.to_string().contains("result-underflow"));
    }
}
