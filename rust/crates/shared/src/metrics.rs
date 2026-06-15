use std::sync::{Arc, RwLock};
use std::time::Duration;
use sysinfo::System;
use tokio::task::JoinHandle;


#[derive(Debug, Clone)]
pub struct CpuSampler {
    value: Arc<RwLock<f64>>,
}

impl CpuSampler {
    pub fn new() -> Self {
        Self {
            value: Arc::new(RwLock::new(0.0)),
        }
    }

    pub fn get(&self) -> f64 {
        self.value.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn start(&self) -> JoinHandle<()> {
        let value = self.value.clone();
        tokio::spawn(async move {
            let mut system = System::new();
            // Initial refresh to establish a baseline.
            system.refresh_cpu_usage();

            let mut interval = tokio::time::interval(Duration::from_secs(1));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

            loop {
                interval.tick().await;
                system.refresh_cpu_usage();
                let usage = system
                    .cpus()
                    .iter()
                    .map(|cpu| cpu.cpu_usage() as f64)
                    .next()
                    .unwrap_or(0.0);
                if let Ok(mut guard) = value.write() {
                    *guard = usage;
                }
            }
        })
    }
}

impl Default for CpuSampler {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct MetricsSnapshot {
    pub uptime: u64,
    pub cpu_percent: f64,
    pub memory_used_gb: f64,
    pub memory_total_gb: f64,
}

pub fn collect_metrics(system: &mut System, cpu_sampler: &CpuSampler) -> MetricsSnapshot {
    system.refresh_memory();

    let total = system.total_memory();
    let used = system.used_memory();

    MetricsSnapshot {
        uptime: System::uptime(),
        cpu_percent: cpu_sampler.get(),
        memory_used_gb: bytes_to_gb(used),
        memory_total_gb: bytes_to_gb(total),
    }
}

fn bytes_to_gb(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0 * 1024.0)
}

pub fn get_hostname() -> String {
    System::host_name().unwrap_or_else(|| "unknown".to_string())
}
