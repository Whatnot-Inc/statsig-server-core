use futures::future::join_all;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tokio::runtime::{Builder, Handle};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use crate::statsig_global::StatsigGlobal;
use crate::StatsigErr;
use crate::{log_d, log_e};

const TAG: &str = stringify!(StatsigRuntime);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct TaskId {
    tag: String,
    tokio_id: tokio::task::Id,
}

pub struct StatsigRuntime {
    spawned_tasks: Arc<Mutex<HashMap<TaskId, JoinHandle<()>>>>,
    shutdown_notify: Arc<Notify>,
    is_shutdown: Arc<AtomicBool>,
    pid: u32,
}

impl StatsigRuntime {
    #[must_use]
    pub fn get_runtime() -> Arc<StatsigRuntime> {
        create_runtime_if_required();

        Arc::new(StatsigRuntime {
            spawned_tasks: Arc::new(Mutex::new(HashMap::new())),
            shutdown_notify: Arc::new(Notify::new()),
            is_shutdown: Arc::new(AtomicBool::new(false)),
            pid: std::process::id(),
        })
    }

    pub fn get_handle(&self) -> Handle {
        // nocommit: remove panics
        if self.pid != std::process::id() {
            panic!("StatsigRuntime::get_handle() called from different process");
        }

        if let Ok(handle) = Handle::try_current() {
            return handle;
        }

        let global = StatsigGlobal::get();
        let rt = global
            .tokio_runtime
            .lock()
            .expect("Failed to lock StatsigGlobal");

        if let Some(rt) = rt.as_ref() {
            return rt.handle().clone();
        }

        panic!("No tokio runtime found");
    }

    pub fn get_num_active_tasks(&self) -> usize {
        match self.spawned_tasks.lock() {
            Ok(lock) => lock.len(),
            Err(e) => {
                log_e!(TAG, "Failed to lock spawned tasks {}", e);
                0
            }
        }
    }

    pub fn shutdown(&self) {
        self.shutdown_notify.notify_waiters();

        if let Ok(mut lock) = self.spawned_tasks.lock() {
            for (_, task) in lock.drain() {
                task.abort();
            }
        }
    }

    pub fn spawn<F, Fut>(&self, tag: &str, task: F) -> tokio::task::Id
    where
        F: FnOnce(Arc<Notify>) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let tag_string = tag.to_string();
        let shutdown_notify = self.shutdown_notify.clone();
        let spawned_tasks = self.spawned_tasks.clone();
        let is_shutdown = self.is_shutdown.clone();

        log_d!(TAG, "Spawning task {}", tag);

        let handle = self.get_handle().spawn(async move {
            if is_shutdown.load(std::sync::atomic::Ordering::Relaxed) {
                return;
            }

            let task_id = tokio::task::id();
            log_d!(TAG, "Executing task {}.{}", tag_string, task_id);
            task(shutdown_notify).await;
            remove_join_handle_with_id(spawned_tasks, tag_string, &task_id);
        });

        self.insert_join_handle(tag, handle)
    }

    pub async fn await_tasks_with_tag(&self, tag: &str) {
        let mut handles = Vec::new();

        match self.spawned_tasks.lock() {
            Ok(mut lock) => {
                let keys: Vec<TaskId> = lock.keys().cloned().collect();
                for key in &keys {
                    if key.tag == tag {
                        let removed = if let Some(handle) = lock.remove(key) {
                            handle
                        } else {
                            log_e!(TAG, "No running task found for tag {}", tag);
                            continue;
                        };

                        handles.push(removed);
                    }
                }
            }
            Err(e) => {
                log_e!(TAG, "Failed to lock spawned tasks {}", e);
                return;
            }
        };

        join_all(handles).await;
    }

    pub async fn await_join_handle(
        &self,
        tag: &str,
        handle_id: &tokio::task::Id,
    ) -> Result<(), StatsigErr> {
        let task_id = TaskId {
            tag: tag.to_string(),
            tokio_id: *handle_id,
        };

        let handle = match self.spawned_tasks.lock() {
            Ok(mut lock) => match lock.remove(&task_id) {
                Some(handle) => handle,
                None => {
                    return Err(StatsigErr::ThreadFailure(
                        "No running task found".to_string(),
                    ));
                }
            },
            Err(e) => {
                log_e!(
                    TAG,
                    "An error occurred while getting join handle with id: {}: {}",
                    handle_id,
                    e.to_string()
                );
                return Err(StatsigErr::ThreadFailure(e.to_string()));
            }
        };

        handle
            .await
            .map_err(|e| StatsigErr::ThreadFailure(e.to_string()))?;

        Ok(())
    }

    fn insert_join_handle(&self, tag: &str, handle: JoinHandle<()>) -> tokio::task::Id {
        let handle_id = handle.id();
        let task_id = TaskId {
            tag: tag.to_string(),
            tokio_id: handle_id,
        };

        match self.spawned_tasks.lock() {
            Ok(mut lock) => {
                lock.insert(task_id, handle);
            }
            Err(e) => {
                log_e!(
                    TAG,
                    "An error occurred while inserting join handle: {}",
                    e.to_string()
                );
            }
        }

        handle_id
    }
}

fn remove_join_handle_with_id(
    spawned_tasks: Arc<Mutex<HashMap<TaskId, JoinHandle<()>>>>,
    tag: String,
    handle_id: &tokio::task::Id,
) {
    let task_id = TaskId {
        tag,
        tokio_id: *handle_id,
    };

    match spawned_tasks.lock() {
        Ok(mut lock) => {
            lock.remove(&task_id);
        }
        Err(e) => {
            log_e!(
                TAG,
                "An error occurred while removing join handle {}",
                e.to_string()
            );
        }
    }
}

fn create_runtime_if_required() {
    if Handle::try_current().is_ok() {
        log_d!(TAG, "External tokio runtime found");
        return;
    }

    let global = StatsigGlobal::get();
    let mut lock = global
        .tokio_runtime
        .lock()
        .expect("Failed to lock owned tokio runtime");

    match lock.as_ref() {
        Some(_) => {
            log_d!(TAG, "Existing StatsigGlobal tokio runtime found");
        }
        None => {
            log_d!(TAG, "Creating new tokio runtime for StatsigGlobal");
            let rt = Arc::new(
                Builder::new_multi_thread()
                    .worker_threads(5)
                    .thread_name("statsig")
                    .enable_all()
                    .build()
                    .expect("Failed to find or create a tokio Runtime"),
            );

            lock.replace(rt);
        }
    };
}

impl Drop for StatsigRuntime {
    fn drop(&mut self) {
        self.shutdown();

        // let opt_inner = match self.inner_runtime.lock() {
        //     Ok(mut inner_runtime) => inner_runtime.take(),
        //     Err(e) => {
        //         log_e!(TAG, "Failed to lock inner runtime {}", e);
        //         None
        //     }
        // };

        // let inner = match opt_inner {
        //     Some(inner) => inner,
        //     None => {
        //         log_d!(TAG, "Runtime owned by tokio");
        //         return;
        //     }
        // };

        // if Arc::strong_count(&inner) > 1 {
        //     // Another instance is still using the Runtime, so we can't drop it
        //     return;
        // }

        // if tokio::runtime::Handle::try_current().is_err() {
        //     println!("Not inside the Tokio runtime. Will automatically drop(inner).");
        //     // Not inside the Tokio runtime. Will automatically drop(inner).
        //     return;
        // }

        // log_w!(TAG, "Attempt to shutdown runtime from inside runtime");
        // std::thread::spawn(move || {
        //     println!("Dropping inner runtime from outside the Tokio runtime");
        //     // We should not drop from inside the runtime, but in the odd case we do,
        //     // moving inner to a new thread will prevent a panic
        //     drop(inner);
        // });
    }
}
