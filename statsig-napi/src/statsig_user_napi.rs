use napi_derive::napi;
use statsig::{instance_store::USER_INSTANCES, log_w, statsig_user::StatsigUserBuilder, DynamicValue};
use std::collections::HashMap;
use serde_json::{from_str, Value};

#[napi]
pub fn statsig_user_create(
    user_id: Option<String>,
    custom_ids: Option<HashMap<String, String>>,
    email: Option<String>,
    ip: Option<String>,
    user_agent: Option<String>,
    country: Option<String>,
    locale: Option<String>,
    app_version: Option<String>,
    custom_json: Option<String>,
    private_attributes_json: Option<String>,
) -> i32 {
    let mut builder = match custom_ids {
        Some(custom_ids) => StatsigUserBuilder::new_with_custom_ids(custom_ids).user_id(user_id),
        None => {
            StatsigUserBuilder::new_with_user_id(user_id.unwrap_or_default()).custom_ids(custom_ids)
        }
    };

    let mut custom = None;
    if let Some(custom_json) = custom_json {
        match from_str::<HashMap<String, DynamicValue>>(&custom_json) {
            Ok(parsed_custom) => custom = Some(parsed_custom),
            Err(_) => {
                log_w!("Invalid type passed to 'Custom'. Expected Record<string, string>");
                return -1;
            }
        }
    }

    let mut private_attributes = None;
    if let Some(private_attributes_json) = private_attributes_json {
        match from_str::<HashMap<String, DynamicValue>>(&private_attributes_json) {
            Ok(parsed_private_attributes) => private_attributes = Some(parsed_private_attributes),
            Err(_) => {
                log_w!("Invalid type passed to 'PrivateAttributes'. Expected Record<string, string>");
                return -1;
            }
        }
    }

    println!("Custom {:?}", custom);

    builder = builder
        .email(email)
        .ip(ip)
        .user_agent(user_agent)
        .country(country)
        .locale(locale)
        .app_version(app_version)
        .custom(custom)
        .private_attributes(private_attributes);

    USER_INSTANCES.add(builder.build())
}

#[napi]
pub fn statsig_user_release(user_ref: i32) {
    USER_INSTANCES.release(user_ref)
}
