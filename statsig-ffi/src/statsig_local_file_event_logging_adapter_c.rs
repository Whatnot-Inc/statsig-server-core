use crate::ffi_utils::{c_char_to_string, string_to_c_char};
use sigstat::instance_store::INST_STORE;
use sigstat::{log_e, unwrap_or_return, StatsigLocalFileEventLoggingAdapter};
use std::os::raw::c_char;

const TAG: &str = "StatsigLocalFileEventLoggingAdapterC";

#[no_mangle]
pub extern "C" fn statsig_local_file_event_logging_adapter_create(
    file_path: *const c_char,
) -> *const c_char {
    let file_path = unwrap_or_return!(c_char_to_string(file_path), std::ptr::null());
    let adapter = StatsigLocalFileEventLoggingAdapter::new(file_path);

    let ref_id = INST_STORE.add(adapter).unwrap_or_else(|| {
        log_e!(TAG, "Failed to create StatsigLocalFileSpecsAdapter");
        "".to_string()
    });

    string_to_c_char(ref_id)
}

#[no_mangle]
pub extern "C" fn statsig_local_file_event_logging_adapter_release(
    event_logging_adapter_ref: *const c_char,
) {
    if let Some(id) = c_char_to_string(event_logging_adapter_ref) {
        INST_STORE.remove(&id);
    }
}
