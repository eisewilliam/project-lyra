APP_DIR := apps/desktop-tauri
CARGO_FLAGS := --manifest-path $(APP_DIR)/src-tauri/Cargo.toml

.DEFAULT_GOAL := help

.PHONY: help dev build check lint test test-one fmt clippy clean

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@printf "  %-20s %s\n" "dev" "Run Tauri dev (hot reload)"
	@printf "  %-20s %s\n" "build" "Production build"
	@printf "  %-20s %s\n" "check" "Type-check Rust without full compile"
	@printf "  %-20s %s\n" "lint" "Frontend lint"
	@printf "  %-20s %s\n" "test" "Run all Rust tests (lyra-core)"
	@printf "  %-20s %s\n" "test-one TEST_NAME=<name>" "Run a single Rust test (lyra-core)"
	@printf "  %-20s %s\n" "fmt" "Format Rust code"
	@printf "  %-20s %s\n" "clippy" "Run clippy on all targets"
	@printf "  %-20s %s\n" "clean" "Clean cargo build artifacts"

dev:
	npm --prefix $(APP_DIR) run tauri dev

build:
	npm --prefix $(APP_DIR) run tauri build

check:
	cargo check $(CARGO_FLAGS)

lint:
	npm --prefix $(APP_DIR) run lint

test:
	cargo test -p lyra-core

test-one:
	cargo test -p lyra-core $(TEST_NAME)

fmt:
	cargo fmt

clippy:
	cargo clippy --all-targets

clean:
	cargo clean
