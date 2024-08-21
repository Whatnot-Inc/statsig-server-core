use crate::evaluation::dynamic_returnable::DynamicReturnable;
use crate::evaluation::dynamic_string::DynamicString;
use crate::evaluation::dynamic_value::DynamicValue;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    #[serde(rename = "type")]
    pub _type: String,
    pub salt: String,
    pub default_value: DynamicReturnable,
    pub enabled: bool,
    pub rules: Vec<Rule>,
    pub id_type: String,
    pub explicit_parameters: Option<Vec<String>>,
    pub entity: String,
    pub has_shared_params: Option<bool>,
    pub is_active: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub name: String,
    pub pass_percentage: f64,
    pub return_value: DynamicReturnable,
    pub id: String,
    pub salt: Option<String>,
    pub conditions: Vec<String>,
    pub id_type: DynamicString,
    pub group_name: Option<String>,
    pub config_delegate: Option<String>,
    pub is_experiment_group: Option<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    #[serde(rename = "type")]
    pub condition_type: String,
    pub target_value: Option<DynamicValue>,
    pub operator: Option<String>,
    pub field: Option<DynamicString>,
    pub additional_values: Option<HashMap<String, DynamicValue>>,
    pub id_type: DynamicString,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SpecsResponseFull {
    pub feature_gates: HashMap<String, Spec>,
    pub dynamic_configs: HashMap<String, Spec>,
    pub layer_configs: HashMap<String, Spec>,
    pub condition_map: HashMap<String, Condition>,
    pub experiment_to_layer: HashMap<String, String>,
    pub has_updates: bool,
    pub time: u64,
}

#[derive(Deserialize)]
pub struct SpecsResponseNoUpdates {
    pub has_updates: bool,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum SpecsResponse {
    Full(Box<SpecsResponseFull>),
    NoUpdates(SpecsResponseNoUpdates),
}

impl<'de> Deserialize<'de> for Condition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ConditionInternal {
            #[serde(rename = "type")]
            condition_type: String,
            target_value: Option<DynamicValue>,
            operator: Option<String>,
            field: Option<DynamicString>,
            additional_values: Option<HashMap<String, DynamicValue>>,
            id_type: DynamicString,
        }

        let mut internal = ConditionInternal::deserialize(deserializer)?;

        if let Some(ref op) = internal.operator {
            if op == "str_matches" {
                if let Some(ref mut tv) = internal.target_value {
                    tv.compile_regex();
                }
            }
        }

        Ok(Condition {
            condition_type: internal.condition_type,
            target_value: internal.target_value,
            operator: internal.operator,
            field: internal.field,
            additional_values: internal.additional_values,
            id_type: internal.id_type,
        })
    }
}
