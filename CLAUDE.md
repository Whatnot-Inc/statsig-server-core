# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a **polyglot monorepo** for Statsig's server-side SDKs. The core logic is written in **Rust** (`statsig-rust`), with language bindings for Node.js, Python, PHP, Java, Elixir, and more. The repository uses a **Cargo workspace** to manage all Rust-based packages.

## Repository Structure

### Core Implementation
- **`statsig-rust/`** - Core Rust SDK containing all business logic for feature gates, dynamic configs, and A/B testing
  - `src/evaluation/` - Feature gate and experiment evaluation engine
  - `src/event_logging/` - Event logging and exposure tracking
  - `src/spec_store.rs` - Manages configuration specs and syncing
  - `src/statsig.rs` - Main SDK entry point
  - `src/networking/` - HTTP client and network providers
  - `src/observability/` - Diagnostics and metrics collection

### Language Bindings
- **`statsig-node/`** - Node.js bindings using NAPI-RS (Rust + TypeScript)
- **`statsig-pyo3/`** - Python bindings using PyO3
- **`statsig-ffi/`** - FFI bindings (C headers, JNI for Java)
- **`statsig-php/`** - PHP bindings using FFI
- **`statsig-elixir/`** - Elixir bindings using Rustler
- **`statsig-java/`** - Java SDK using JNI
- **`statsig-go/`** - Go SDK using CGO
- **`statsig-dotnet/`** - .NET bindings

### Supporting Packages
- **`statsig-grpc/`** - gRPC support for proxying requests
- **`cli/`** - Internal CLI tool for development tasks (TypeScript)
- **`tools/`** - Build scripts and Docker configurations
- **`examples/`** - Usage examples for each language

## Common Development Commands

### Rust Core

```bash
# Build the workspace
cargo build

# Build release version
cargo build --release

# Run all tests
cargo test --workspace

# Run tests for a specific package
cargo test -p statsig-rust

# Run a specific test
cargo test test_name -p statsig-rust

# Lint with Clippy
cargo clippy --workspace --all-features --tests -- -D warnings

# Format code
cargo fmt --all --check  # Check formatting
cargo fmt --all          # Apply formatting
```

### Node.js Bindings

```bash
cd statsig-node

# Install dependencies
npm install  # or use pnpm/yarn

# Run tests
npm test

# Run specific test
npm test -- DataStore.test.ts

# Build native module
npm run build  # Uses @napi-rs/cli under the hood
```

### Python Bindings

```bash
cd statsig-pyo3

# Build Python package
cargo build --release

# Generate Python stubs
cargo run --bin stub_gen --package statsig-pyo3

# Run Python tests
python -m pytest tests/
```

### PHP Bindings

```bash
cd statsig-php

# Install dependencies
composer install

# Run tests
composer test

# Run verbose tests
composer test:verbose

# Lint
composer lint
```

### Elixir Bindings

```bash
cd statsig-elixir

# Install dependencies
mix deps.get

# Compile (including Rust NIF)
mix compile

# Run tests
mix test
```

## Architecture

### Core Evaluation Flow

1. **Initialization** (`Statsig::new()` in `statsig.rs`)
   - SDK key validation and hashing
   - Specs adapter initialization (HTTP or custom)
   - Event logger setup for exposures/events
   - Optional DataStore for persistence
   - Background sync tasks start

2. **Spec Syncing** (`SpecStore` in `spec_store.rs`)
   - Downloads feature gate/config/experiment definitions from Statsig API
   - Stores in-memory with `Arc<RwLock<SpecStoreData>>`
   - Optional persistence via `DataStoreTrait`
   - Periodic background updates (default: 10 seconds)

3. **Evaluation** (`Evaluator` in `evaluation/evaluator.rs`)
   - Takes a `StatsigUser` and spec name
   - Evaluates conditions and rules from specs
   - Supports targeting by user attributes, custom fields, country, device type, etc.
   - Returns `EvaluationDetails` with value and metadata
   - Logs exposures to event queue

4. **Event Logging** (`EventLogger` in `event_logging/event_logger.rs`)
   - Queues exposures and custom events
   - Batches events for efficient network usage
   - Flushes periodically or on shutdown
   - Adapter pattern for custom logging destinations

### Language Binding Pattern

All language bindings follow a similar pattern:
1. **Native Module** - Rust code compiled to native library (`.node`, `.so`, `.dll`, etc.)
2. **Type Conversion Layer** - Convert between Rust types and language-specific types
3. **Idiomatic API** - Expose language-specific ergonomic APIs (async/await, promises, etc.)
4. **Test Suite** - Language-specific tests in addition to Rust core tests

For example, `statsig-node`:
- `src/lib.rs` - Main NAPI entry point
- `src/statsig_napi.rs` - Statsig API exposed to Node.js
- `src/statsig_user_napi.rs` - User type conversion
- `src/__tests__/*.test.ts` - Jest tests in TypeScript

### Shared State Management

- **`Arc<RwLock<T>>`** pattern for shared mutable state (SpecStore, EventLogger)
- **`Arc<Mutex<T>>`** for simpler locking
- **Tokio runtime** for async operations (all background tasks)
- **`lazy_static!`** for global singletons (e.g., shared Statsig instance)

## Important Patterns

### Adapter Pattern
The SDK uses adapters for extensibility:
- **`SpecsAdapter`** - Custom config fetching (default: HTTP)
- **`EventLoggingAdapter`** - Custom event destinations (default: HTTP)
- **`DataStoreTrait`** - Custom persistence (default: file-based)
- **`OverrideAdapter`** - Local overrides for testing
- **`ObservabilityClient`** - Custom metrics/diagnostics

### Error Handling
- `StatsigErr` enum for all SDK errors
- Non-blocking: Most errors are logged but don't crash
- Error boundary events tracked via `SDKErrorsObserver`

### Testing Philosophy
- Unit tests in Rust core (`statsig-rust/tests/`)
- Integration tests in language bindings
- Tests should be deterministic (avoid sleeps, use mocking)
- Serial tests marked with `#[serial_test::serial]` for shared state

## CI/CD

The repository uses GitHub Actions with a complex build matrix:
- **Plan phase** - Python script (`.github/build_plan.py`) determines what to build
- **Build phase** - Matrix builds across platforms (Linux, macOS, Windows) and architectures (x86_64, aarch64)
- **Lint checks** - Clippy, rustfmt, PHP Code Sniffer, Python stub gen
- **Publishing** - Automated to NPM, PyPI, Packagist, Maven, NuGet, Hex.pm

Releases are managed via:
- Release branches (`releases/*`)
- Release candidates (`betas/*`)
- GitHub releases trigger publishing

## Building Native Binaries

Cross-compilation is handled via:
- Docker images in `tools/docker/` for Linux targets
- Native runners for macOS and Windows
- Target-specific builds defined in package metadata (e.g., `napi.targets` in `statsig-node/package.json`)

## Development Tips

### Dependency Updates
- Rust deps managed in root `Cargo.toml` workspace settings where possible
- Each binding has its own language-specific deps

### Debugging
- Enable Rust logs: `RUST_LOG=debug cargo test`
- Use `log_d!()`, `log_e!()`, `log_w!()` macros in Rust code (defined in `macros.rs`)
- Output logger interface for custom logging in production

### Adding New Features
1. Implement in `statsig-rust` core first
2. Add Rust tests
3. Expose via FFI/NAPI/PyO3 in relevant bindings
4. Add language-specific tests
5. Update Python stubs if modifying PyO3: `cargo run --bin stub_gen --package statsig-pyo3`

### Working with Specs
- Specs are JSON configurations from Statsig API
- Defined in `specs_response/spec_types.rs`
- Use `Spec`, `Rule`, `Condition` types for evaluation logic
- Specs are immutable once loaded (atomic swaps via `Arc`)
