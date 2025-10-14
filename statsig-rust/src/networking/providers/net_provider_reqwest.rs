use std::collections::HashMap;
use std::io::{BufReader, Seek, SeekFrom, Write};
use std::time::Duration;

use async_trait::async_trait;

use crate::{
    log_d, log_e, log_i, log_w,
    networking::{
        http_types::{HttpMethod, RequestArgs, Response, ResponseData},
        NetworkProvider,
    },
    StatsigErr,
};

use crate::networking::proxy_config::ProxyConfig;
use reqwest::Method;

const TAG: &str = "NetworkProviderReqwest";

pub struct NetworkProviderReqwest {}

#[async_trait]
impl NetworkProvider for NetworkProviderReqwest {
    async fn send(&self, method: &HttpMethod, args: &RequestArgs) -> Response {
        if let Some(is_shutdown) = &args.is_shutdown {
            if is_shutdown.load(std::sync::atomic::Ordering::SeqCst) {
                return Response {
                    status_code: None,
                    data: None,
                    error: Some("Request was shutdown".to_string()),
                    headers: None,
                };
            }
        }

        let request = self.build_request(method, args);

        let mut error = None;
        let mut status_code = None;
        let mut data = None;
        let mut headers = None;

        match request.send().await {
            Ok(response) => {
                status_code = Some(response.status().as_u16());
                let content_length = response.content_length();
                let version = response.version();
                headers = get_response_headers(&response);

                log_i!(
                    TAG,
                    "Response received: status={:?}, http_version={:?}, content_length={:?}, headers_count={}",
                    status_code,
                    version,
                    content_length,
                    headers.as_ref().map(|h| h.len()).unwrap_or(0)
                );

                match Self::write_response_to_temp_file(response).await {
                    Ok(response_data) => {
                        log_i!(TAG, "Successfully wrote response body to temp file");
                        data = Some(response_data);
                    }
                    Err(e) => {
                        let err_msg = format!("Failed to write response body: {}", e);
                        log_e!(TAG, "{}", err_msg);
                        error = Some(err_msg);
                    }
                }
            }
            Err(e) => {
                let error_message = get_error_message(e);
                log_e!(TAG, "Request send failed: {}", error_message);
                error = Some(error_message);
            }
        }

        Response {
            status_code,
            data,
            error,
            headers,
        }
    }
}

impl NetworkProviderReqwest {
    fn build_request(
        &self,
        method: &HttpMethod,
        request_args: &RequestArgs,
    ) -> reqwest::RequestBuilder {
        let method_actual = match method {
            HttpMethod::GET => Method::GET,
            HttpMethod::POST => Method::POST,
        };
        let is_post = method_actual == Method::POST;

        let mut client_builder = reqwest::Client::builder();

        // configure proxy if available
        if let Some(proxy_config) = request_args.proxy_config.as_ref() {
            client_builder = Self::configure_proxy(client_builder, proxy_config);
        }

        let client = client_builder.build().unwrap_or_else(|e| {
            log_e!(TAG, "Failed to build reqwest client with proxy config: {}. Falling back to default client.", e);
            reqwest::Client::new()
        });

        let mut request = client.request(method_actual, &request_args.url);

        let timeout_duration = match request_args.timeout_ms > 0 {
            true => Duration::from_millis(request_args.timeout_ms),
            false => Duration::from_secs(10),
        };
        request = request.timeout(timeout_duration);

        // Set Accept-Encoding header if gzip is accepted
        // This tells the server we can handle compressed responses
        // and enables reqwest's automatic decompression
        if request_args.accept_gzip_response {
            request = request.header("Accept-Encoding", "gzip, deflate, br");
        }

        if let Some(headers) = &request_args.headers {
            for (key, value) in headers {
                request = request.header(key, value);
            }
        }

        if let Some(params) = &request_args.query_params {
            request = request.query(params);
        }

        if is_post {
            let bytes = match &request_args.body {
                Some(b) => b.clone(),
                None => vec![],
            };
            let byte_len = bytes.len();

            request = request.body(bytes);
            request = request.header("Content-Length", byte_len.to_string());
        }

        request
    }

    fn configure_proxy(
        client_builder: reqwest::ClientBuilder,
        proxy_config: &ProxyConfig,
    ) -> reqwest::ClientBuilder {
        let (Some(host), Some(port)) = (&proxy_config.proxy_host, &proxy_config.proxy_port) else {
            return client_builder;
        };

        let proxy_url = format!(
            "{}://{}:{}",
            proxy_config.proxy_protocol.as_deref().unwrap_or("http"),
            host,
            port
        );

        let Ok(proxy) = reqwest::Proxy::all(&proxy_url) else {
            log_w!(TAG, "Failed to create proxy for URL: {}", proxy_url);
            return client_builder;
        };

        let Some(auth) = &proxy_config.proxy_auth else {
            return client_builder.proxy(proxy);
        };

        let Some((username, password)) = auth.split_once(':') else {
            log_w!(
                TAG,
                "Invalid proxy auth format. Expected 'username:password'"
            );
            return client_builder.proxy(proxy);
        };

        client_builder.proxy(proxy.basic_auth(username, password))
    }

    async fn write_response_to_temp_file(
        response: reqwest::Response,
    ) -> Result<ResponseData, StatsigErr> {
        let mut response = response;
        let mut temp_file = tempfile::spooled_tempfile(1024 * 1024 * 2); // 2MB
        let mut total_bytes = 0usize;
        let mut chunk_count = 0usize;

        log_d!(TAG, "Starting to read response body chunks");

        loop {
            log_d!(TAG, "Awaiting next chunk... (chunks read so far: {})", chunk_count);

            match response.chunk().await {
                Ok(Some(item)) => {
                    let chunk_size = item.len();
                    total_bytes += chunk_size;
                    chunk_count += 1;

                    log_d!(
                        TAG,
                        "Received chunk #{}: {} bytes (total: {} bytes)",
                        chunk_count,
                        chunk_size,
                        total_bytes
                    );

                    temp_file.write_all(&item).map_err(|e| {
                        let err = format!("Failed to write chunk to temp file: {}", e);
                        log_e!(TAG, "{}", err);
                        StatsigErr::FileError(err)
                    })?;
                }
                Ok(None) => {
                    log_i!(
                        TAG,
                        "Finished reading response body: {} chunks, {} total bytes",
                        chunk_count,
                        total_bytes
                    );
                    break;
                }
                Err(e) => {
                    let err = format!(
                        "Error reading chunk (after {} chunks, {} bytes): {}",
                        chunk_count, total_bytes, e
                    );
                    log_e!(TAG, "{}", err);
                    return Err(StatsigErr::FileError(err));
                }
            }
        }

        if total_bytes == 0 {
            log_w!(TAG, "WARNING: Response body was empty (0 bytes read)");
        }

        log_d!(TAG, "Seeking temp file back to start");
        temp_file.seek(SeekFrom::Start(0)).map_err(|e| {
            let err = format!("Failed to seek temp file: {}", e);
            log_e!(TAG, "{}", err);
            StatsigErr::FileError(err)
        })?;

        log_d!(TAG, "Creating BufReader from temp file");
        let reader = BufReader::new(temp_file);
        Ok(ResponseData::from_stream(Box::new(reader)))
    }
}

fn get_error_message(error: reqwest::Error) -> String {
    let mut error_message = error.to_string();

    if let Some(url_error) = error.url() {
        error_message.push_str(&format!(". URL: {}", url_error));
    }

    if let Some(status_error) = error.status() {
        error_message.push_str(&format!(". Status: {}", status_error));
    }

    error_message
}

fn get_response_headers(response: &reqwest::Response) -> Option<HashMap<String, String>> {
    let headers = response.headers();
    if headers.is_empty() {
        return None;
    }

    let mut headers_map = HashMap::new();
    for (key, value) in headers {
        headers_map.insert(key.to_string(), value.to_str().unwrap_or("").to_string());
    }

    Some(headers_map)
}
