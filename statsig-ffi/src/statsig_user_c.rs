use crate::ffi_utils::{
    c_char_to_string, parse_json_to_map, parse_json_to_str_map, string_to_c_char,
};
use sigstat::instance_store::INST_STORE;
use sigstat::log_e;
use sigstat::statsig_user::StatsigUserBuilder;
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn statsig_user_create(
    user_id: *const c_char,
    custom_ids_json: *const c_char,
    email: *const c_char,
    ip: *const c_char,
    user_agent: *const c_char,
    country: *const c_char,
    locale: *const c_char,
    app_version: *const c_char,
    custom_json: *const c_char,
    private_attributes_json: *const c_char,
) -> *const c_char {
    // Convert C strings to Rust Options
    let user_id = c_char_to_string(user_id);
    let custom_ids = parse_json_to_str_map(c_char_to_string(custom_ids_json));
    let email = c_char_to_string(email);
    let ip = c_char_to_string(ip);
    let user_agent = c_char_to_string(user_agent);
    let country = c_char_to_string(country);
    let locale = c_char_to_string(locale);
    let app_version = c_char_to_string(app_version);
    let custom = parse_json_to_map(c_char_to_string(custom_json));
    let private_attributes = parse_json_to_map(c_char_to_string(private_attributes_json));

    let mut builder = match custom_ids {
        Some(custom_ids) => StatsigUserBuilder::new_with_custom_ids(custom_ids).user_id(user_id),
        None => StatsigUserBuilder::new_with_user_id(user_id.unwrap_or_default()).custom_ids(None),
    };

    builder = builder
        .email(email)
        .ip(ip)
        .user_agent(user_agent)
        .country(country)
        .locale(locale)
        .app_version(app_version)
        .custom(custom)
        .private_attributes(private_attributes);

    let user = builder.build();
    let ref_id = INST_STORE.add(user).unwrap_or_else(|| {
        log_e!("Failed to create StatsigOptions");
        "".to_string()
    });

    string_to_c_char(ref_id)
}

#[no_mangle]
pub extern "C" fn statsig_user_release(user_ref: *const c_char) {
    if let Some(id) = c_char_to_string(user_ref) {
        INST_STORE.remove(&id);
    }
}
