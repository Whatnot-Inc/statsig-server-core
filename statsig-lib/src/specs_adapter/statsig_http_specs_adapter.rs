use crate::network_client::{NetworkClient, RequestArgs};
use crate::specs_adapter::{SpecsAdapter, SpecsUpdate, SpecsUpdateListener};
use crate::statsig_err::StatsigErr;
use crate::statsig_metadata::StatsigMetadata;
use crate::{log_e, SpecsSource};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock, Weak};
use std::time::Duration;
use tokio::runtime::Handle;
use tokio::sync::Notify;
use tokio::task;
use tokio::time::{interval_at, Instant};

pub const DEFAULT_SPECS_URL: &str = "https://api.statsigcdn.com/v2/download_config_specs";
const DEFAULT_SYNC_INTERVAL_MS: u32 = 10_000;

pub struct StatsigHttpSpecsAdapter {
    specs_url: String,
    network: NetworkClient,
    listener: RwLock<Option<Arc<dyn SpecsUpdateListener>>>,
    sync_interval_duration: Duration,
    shutdown_notify: Arc<Notify>,
    task_handle: Mutex<Option<task::JoinHandle<()>>>,
}

impl StatsigHttpSpecsAdapter {
    pub fn new(
        sdk_key: &str,
        specs_url: Option<&String>,
        _timeout: u64,
        sync_interval: Option<u32>,
    ) -> Self {
        let headers = StatsigMetadata::get_constant_request_headers(sdk_key);

        Self {
            specs_url: construct_specs_url(sdk_key, specs_url),
            network: NetworkClient::new(Some(headers)),
            listener: RwLock::new(None),
            shutdown_notify: Arc::new(Notify::new()),
            task_handle: Mutex::new(None),
            sync_interval_duration: Duration::from_millis(
                sync_interval.unwrap_or(DEFAULT_SYNC_INTERVAL_MS) as u64,
            ),
        }
    }

    pub fn fetch_specs_from_network(&self, current_store_lcut: Option<u64>) -> Option<String> {
        let query_params =
            current_store_lcut.map(|lcut| HashMap::from([("sinceTime".into(), lcut.to_string())]));

        self.network.get(RequestArgs {
            url: self.specs_url.clone(),
            retries: 2,
            query_params,
            accept_gzip_response: true,
            ..RequestArgs::new()
        })
    }

    fn schedule_background_sync(
        self: Arc<Self>,
        runtime_handle: &Handle,
    ) -> Result<(), StatsigErr> {
        let weak_self = Arc::downgrade(&self);

        let interval_duration = self.sync_interval_duration;
        let shutdown_notify = Arc::clone(&self.shutdown_notify);

        let handle = runtime_handle.spawn(async move {
            let mut interval = interval_at(Instant::now() + interval_duration, interval_duration);
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        Self::run_background_sync(&weak_self).await
                    }
                    _ = shutdown_notify.notified() => {
                        break;
                    }
                }
            }
        });

        match self.task_handle.lock() {
            Ok(mut guard) => {
                *guard = Some(handle);
                Ok(())
            }
            Err(e) => Err(StatsigErr::LockFailure(e.to_string())),
        }
    }

    async fn run_background_sync(weak_self: &Weak<Self>) {
        if let Some(strong_self) = weak_self.upgrade() {
            let lcut = match strong_self.listener.read() {
                Ok(lock) => match lock.as_ref() {
                    Some(listener) => listener.get_current_specs_info().lcut,
                    None => None,
                },
                Err(_) => None,
            };

            if let Err(e) = strong_self.manually_sync_specs(lcut).await {
                log_e!("Background specs sync failed: {}", e);
            }
        }
    }

    async fn manually_sync_specs(&self, current_store_lcut: Option<u64>) -> Result<(), StatsigErr> {
        if let Ok(lock) = self.listener.read() {
            if lock.is_none() {
                return Err(StatsigErr::UnstartedAdapter("Listener not set".to_string()));
            }
        }

        let res = self.fetch_specs_from_network(current_store_lcut);

        let data = match res {
            Some(r) => r,
            None => {
                log_e!("No result from network");
                return Err(StatsigErr::NetworkError(
                    "No result from network".to_string(),
                ));
            }
        };

        let update = SpecsUpdate {
            data,
            source: SpecsSource::Network,
            received_at: Utc::now().timestamp_millis() as u64,
        };

        match &self.listener.read() {
            Ok(lock) => match lock.as_ref() {
                Some(listener) => {
                    listener.did_receive_specs_update(update);
                    Ok(())
                }
                None => Err(StatsigErr::UnstartedAdapter("Listener not set".to_string())),
            },
            Err(e) => return Err(StatsigErr::LockFailure(e.to_string())),
        }
    }
}

#[async_trait]
impl SpecsAdapter for StatsigHttpSpecsAdapter {
    async fn start(
        self: Arc<Self>,
        _runtime_handle: &Handle,
        listener: Arc<dyn SpecsUpdateListener + Send + Sync>,
    ) -> Result<(), StatsigErr> {
        let lcut = listener.get_current_specs_info().lcut;
        if let Ok(mut mut_listener) = self.listener.write() {
            *mut_listener = Some(listener);
        }
        self.manually_sync_specs(lcut).await
    }

    fn schedule_background_sync(
        self: Arc<Self>,
        runtime_handle: &Handle,
    ) -> Result<(), StatsigErr> {
        self.schedule_background_sync(runtime_handle)
    }

    async fn shutdown(&self, timeout: Duration) -> Result<(), StatsigErr> {
        self.shutdown_notify.notify_one();

        let task_handle = {
            match self.task_handle.lock() {
                Ok(mut guard) => guard.take(),
                Err(_) => {
                    return Err(StatsigErr::CustomError(
                        "Failed to acquire lock to running task".to_string(),
                    ))
                }
            }
        };

        match task_handle {
            None => Err(StatsigErr::CustomError(
                "No running task to shut down".to_string(),
            )),
            Some(handle) => {
                let shutdown_future = handle;
                let shutdown_result = tokio::time::timeout(timeout, shutdown_future).await;

                if shutdown_result.is_err() {
                    return Err(StatsigErr::CustomError(
                        "Failed to gracefully shutdown StatsigSpecsAdapter.".to_string(),
                    ));
                }

                Ok(())
            }
        }
    }

    fn get_type_name(&self) -> String {
        stringify!(StatsigHttpSpecsAdapter).to_string()
    }
}

fn construct_specs_url(sdk_key: &str, spec_url: Option<&String>) -> String {
    let base = match spec_url {
        Some(u) => u,
        _ => DEFAULT_SPECS_URL,
    };

    format!("{}/{}.json", base, sdk_key)
}
