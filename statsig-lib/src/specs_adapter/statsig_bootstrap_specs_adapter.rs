use crate::specs_adapter::{SpecsAdapter, SpecsSource, SpecsUpdate, SpecsUpdateListener};
use crate::statsig_err::StatsigErr;
use async_trait::async_trait;
use chrono::Utc;

use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::runtime::Handle;

pub struct StatsigBootstrapSpecsAdapter {
    data: RwLock<String>,
    listener: RwLock<Option<Arc<dyn SpecsUpdateListener>>>,
}

impl StatsigBootstrapSpecsAdapter {
    pub fn new(data: String) -> Self {
        Self {
            data: RwLock::new(data),
            listener: RwLock::new(None),
        }
    }

    pub fn set_data(&self, data: String) -> Result<(), StatsigErr> {
        match self.data.write() {
            Ok(mut lock) => *lock = data.clone(),
            Err(_) => return Err(StatsigErr::SpecsAdapterLockFailure),
        };

        self.push_update()
    }

    fn push_update(&self) -> Result<(), StatsigErr> {
        let data = match self.data.read() {
            Ok(lock) => lock.clone(),
            Err(_) => return Err(StatsigErr::SpecsAdapterLockFailure),
        };

        match &self.listener.read() {
            Ok(lock) => match lock.as_ref() {
                Some(listener) => {
                    listener.did_receive_specs_update(SpecsUpdate {
                        data,
                        source: SpecsSource::Bootstrap,
                        received_at: Utc::now().timestamp_millis() as u64,
                    });
                    Ok(())
                }
                None => Err(StatsigErr::SpecsListenerNotSet),
            },
            Err(_) => return Err(StatsigErr::SpecsListenerNotSet),
        }
    }
}

#[async_trait]
impl SpecsAdapter for StatsigBootstrapSpecsAdapter {
    async fn start(
        self: Arc<Self>,
        _runtime_handle: &Handle,
        listener: Arc<dyn SpecsUpdateListener + Send + Sync>,
    ) -> Result<(), StatsigErr> {
        if let Ok(mut mut_listener) = self.listener.write() {
            *mut_listener = Some(listener);
        }

        self.push_update()
    }

    async fn shutdown(&self, _timeout: Duration) -> Result<(), StatsigErr> {
        Ok(())
    }

    fn schedule_background_sync(
        self: Arc<Self>,
        _runtime_handle: &Handle,
    ) -> Result<(), StatsigErr> {
        Ok(())
    }

    fn get_type_name(&self) -> String {
        stringify!(StatsigBootstrapSpecsAdapter).to_string()
    }
}

#[cfg(test)]
mod tests {
    use crate::SpecsInfo;

    use super::*;
    use std::sync::Arc;
    use tokio::runtime::Runtime;

    struct TestListener {
        received_update: RwLock<Option<SpecsUpdate>>,
    }

    impl TestListener {
        fn new() -> Self {
            Self {
                received_update: RwLock::new(None),
            }
        }
    }

    #[async_trait]
    impl SpecsUpdateListener for TestListener {
        fn did_receive_specs_update(&self, update: SpecsUpdate) {
            if let Ok(mut lock) = self.received_update.write() {
                *lock = Some(update);
            }
        }

        fn get_current_specs_info(&self) -> SpecsInfo {
            SpecsInfo {
                lcut: None,
                source: SpecsSource::NoValues,
            }
        }
    }

    #[test]
    fn test_manually_sync_specs() {
        let rt = Runtime::new().unwrap();
        let test_data = serde_json::json!({
            "feature_gates": {},
            "dynamic_configs": {},
            "layer_configs": {},
        })
        .to_string();

        let adapter = Arc::new(StatsigBootstrapSpecsAdapter::new(test_data.clone()));
        let listener = Arc::new(TestListener::new());

        rt.block_on(adapter.clone().start(&rt.handle(), listener.clone()))
            .unwrap();

        if let Ok(lock) = listener.clone().received_update.read() {
            let update = lock.as_ref().unwrap();
            assert_eq!(update.source, SpecsSource::Bootstrap);
            assert_eq!(update.data, test_data);
        }
    }

    #[test]
    fn test_set_data() {
        let rt = Runtime::new().unwrap();

        let adapter = Arc::new(StatsigBootstrapSpecsAdapter::new("".to_string()));

        let listener = Arc::new(TestListener::new());
        rt.block_on(adapter.clone().start(&rt.handle(), listener.clone()))
            .unwrap();

        let test_data = "{\"some\": \"value\"}".to_string();
        let result = adapter.set_data(test_data.clone());
        assert_eq!(result.is_err(), false);

        if let Ok(lock) = listener.clone().received_update.read() {
            let update = lock.as_ref().unwrap();
            assert_eq!(update.source, SpecsSource::Bootstrap);
            assert_eq!(update.data, test_data);
        }
    }
}
