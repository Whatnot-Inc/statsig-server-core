use crate::dyn_value;
use crate::evaluation::dynamic_value::DynamicValue;
use crate::evaluation::evaluation_details::EvaluationDetails;
use crate::evaluation::evaluation_types::{
    DynamicConfigEvaluation, ExperimentEvaluation, GateEvaluation, LayerEvaluation,
};
use crate::statsig_types::{DynamicConfig, Experiment, FeatureGate, Layer};
use crate::statsig_user_internal::StatsigUserInternal;
use serde_json::Value;
use std::collections::HashMap;

pub fn make_feature_gate(
    name: &str,
    evaluation: Option<GateEvaluation>,
    details: EvaluationDetails,
) -> FeatureGate {
    let (value, rule_id, id_type) = match &evaluation {
        Some(e) => (e.value, e.base.rule_id.clone(), e.base.id_type.clone()),
        None => (false, "default".into(), "".into()),
    };

    FeatureGate {
        name: name.to_string(),
        rule_id,
        id_type,
        value,
        details,
        __evaluation: evaluation,
    }
}

fn extract_from_experiment_evaluation(
    evaluation: &Option<ExperimentEvaluation>,
) -> (
    HashMap<String, DynamicValue>,
    String,
    String,
    Option<String>,
) {
    match &evaluation {
        Some(e) => (
            value_to_hashmap(&e.base.value),
            e.base.base.rule_id.clone(),
            e.base.base.id_type.clone(),
            e.group_name.clone(),
        ),
        None => (HashMap::new(), "default".into(), "".into(), None),
    }
}

pub fn make_dynamic_config(
    name: &str,
    evaluation: Option<DynamicConfigEvaluation>,
    details: EvaluationDetails,
) -> DynamicConfig {
    let (value, rule_id, id_type) = match &evaluation {
        Some(e) => (
            value_to_hashmap(&e.value),
            e.base.rule_id.clone(),
            e.base.id_type.clone(),
        ),
        None => (HashMap::new(), "default".into(), "".into()),
    };

    DynamicConfig {
        name: name.to_string(),
        rule_id,
        id_type,
        value,
        details,
        __evaluation: evaluation,
    }
}

pub fn make_experiment(
    name: &str,
    evaluation: Option<ExperimentEvaluation>,
    details: EvaluationDetails,
) -> Experiment {
    let (value, rule_id, id_type, group_name) = extract_from_experiment_evaluation(&evaluation);

    Experiment {
        name: name.to_string(),
        rule_id,
        id_type,
        value,
        details: details.clone(),
        group_name,
        __evaluation: evaluation,
    }
}

pub fn make_layer(
    user: &StatsigUserInternal,
    name: &str,
    evaluation: Option<LayerEvaluation>,
    details: EvaluationDetails,
) -> Layer {
    let (value, rule_id, id_type) = match &evaluation {
        Some(e) => (
            value_to_hashmap(&e.base.value),
            e.base.base.rule_id.clone(),
            e.base.base.id_type.clone(),
        ),
        None => (HashMap::new(), "default".into(), "".into()),
    };

    Layer {
        name: name.to_string(),
        rule_id,
        id_type,
        details: details.clone(),
        group_name: None,
        __value: value,
        __evaluation: evaluation,
        __user: user.clone(),
    }
}

fn value_to_hashmap(value: &Value) -> HashMap<String, DynamicValue> {
    let mapped = value.as_object().map(|e| {
        e.iter()
            .map(|(k, v)| (k.clone(), dyn_value!(v.clone())))
            .collect()
    });

    mapped.unwrap_or_default()
}
