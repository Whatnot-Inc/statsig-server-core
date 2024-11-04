#[cfg(test)]
#[cfg(feature = "with_grpc")]
pub mod specs_adapter_tests {
    use mock_forward_proxy::wait_one_ms;
    use sigstat::output_logger::{initialize_simple_output_logger, LogLevel};
    use sigstat::{AdapterType, SpecAdapterConfig, SpecsSource, SpecsInfo, SpecsUpdate, SpecsUpdateListener};
    use sigstat::StatsigGrpcSpecAdapter;
    use sigstat::SpecsAdapter;
    use statsig_grpc::mock_forward_proxy::MockForwardProxy;
    use statsig_grpc::*;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::runtime::Handle;
    use tokio::sync::Notify;
    use tokio::time::error::Elapsed;
    use tokio::time::timeout;

    async fn setup() -> (
        Arc<MockForwardProxy>,
        Arc<MockListener>,
        Arc<StatsigGrpcSpecAdapter>,
    ) {
        initialize_simple_output_logger(&Some(LogLevel::Debug));

        let mock_proxy = MockForwardProxy::spawn().await;
        let config = SpecAdapterConfig {
            adapter_type: AdapterType::NetworkGrpcWebsocket,
            specs_url: format!("http://{}", mock_proxy.proxy_address),
            init_timeout_ms: 3000,
        };
        let adapter = Arc::new(StatsigGrpcSpecAdapter::new("secret-key", &config));
        let mock_listener = Arc::new(MockListener::default());

        (mock_proxy, mock_listener, adapter)
    }

    #[tokio::test]
    async fn test_shutting_down() {
        let (mock_proxy, mock_listener, adapter) = setup().await;
        mock_proxy
            .send_stream_update(Ok(ConfigSpecResponse {
                spec: "bg_sync".to_string(),
                last_updated: 123,
            }))
            .await;
        adapter
            .clone()
            .start(&Handle::current(), mock_listener.clone())
            .await
            .unwrap();
        adapter.shutdown(Duration::from_millis(1)).await.unwrap();

        wait_one_ms().await;

        let received_update = mock_listener.nullable_get_most_recent_update();
        assert!(received_update.is_some());
    }

    #[tokio::test]
    async fn test_reconnecting() {
        let (mock_proxy, mock_listener, adapter) = setup().await;

        mock_proxy
            .send_stream_update(Ok(ConfigSpecResponse {
                spec: "first_sync".to_string(),
                last_updated: 123,
            }))
            .await;
        adapter
            .clone()
            .start(&Handle::current(), mock_listener.clone())
            .await
            .unwrap();
        mock_listener.wait_for_next_update().await.unwrap();

        mock_proxy.clone().restart().await;

        mock_proxy
            .send_stream_update(Ok(ConfigSpecResponse {
                spec: "reconnected_sync".to_string(),
                last_updated: 123,
            }))
            .await;

        mock_listener.wait_for_next_update().await.unwrap();

        let received_update = mock_listener.force_get_most_recent_update();
        assert_eq!(received_update.data, "reconnected_sync");
        assert_eq!(received_update.source, SpecsSource::Network);
    }

    #[derive(Default)]
    pub struct MockListener {
        pub received_update: Mutex<Option<SpecsUpdate>>,
        next_update_notify: Mutex<Option<Arc<Notify>>>,
    }

    impl MockListener {
        pub async fn wait_for_next_update(&self) -> Result<(), Elapsed> {
            let notify = Arc::new(Notify::new());
            {
                *self.next_update_notify.lock().unwrap() = Some(notify.clone());
            }

            timeout(Duration::from_secs(10), notify.notified()).await
        }

        pub fn force_get_most_recent_update(&self) -> SpecsUpdate {
            self.nullable_get_most_recent_update().unwrap()
        }

        pub fn nullable_get_most_recent_update(&self) -> Option<SpecsUpdate> {
            self.received_update.lock().unwrap().take()
        }
    }
    impl SpecsUpdateListener for MockListener {
        fn did_receive_specs_update(&self, update: SpecsUpdate) {
            *self.received_update.lock().unwrap() = Some(update);

            let notify = self.next_update_notify.lock().unwrap().take();
            if let Some(notify) = notify {
                notify.notify_one();
            }
        }

        fn get_current_specs_info(&self) -> SpecsInfo {
            SpecsInfo {
                lcut: None,
                source: SpecsSource::NoValues,
            }
        }
    }
}
