# Versorium — task shortcuts.
#
# Two things on this machine need absolute paths, and both are why this file
# exists rather than bare pnpm scripts:
#   - the corepack/nvm `pnpm` shim is broken, so PNPM is resolved explicitly
#   - `java` on PATH is the macOS stub that exits non-zero, so epubcheck needs
#     the real JDK named
# Override either on the command line: `make dev PNPM=pnpm`.

PNPM ?= /opt/homebrew/bin/pnpm
JAVA ?= /opt/homebrew/opt/openjdk/bin/java
CARGO_MANIFEST := src-tauri/Cargo.toml
EPUBCHECK_VERSION := 5.2.1
EPUBCHECK_DIR := /tmp/m5/epubcheck-$(EPUBCHECK_VERSION)
DEV_URL := http://localhost:1420

.DEFAULT_GOAL := help
.PHONY: help dev devtools web mock bundle deps check test test-ui test-e2e \
        test-e2e-ui test-live verify clippy fmt fmt-check lint mcp tools clean

help: ## Show this list
	@printf '\nVersorium — make targets\n\n'
	@grep -hE '^[a-z][a-zA-Z0-9_-]*:.*?## ' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@printf '\n'

# --- running ---

dev: ## Run the desktop app (Tauri + Vite, hot reload)
	$(PNPM) tauri dev

devtools: ## Run the desktop app with the Web Inspector already open
	VERSORIUM_DEVTOOLS=1 $(PNPM) tauri dev

web: ## Serve the frontend alone in a browser (no Rust, no Tauri APIs)
	$(PNPM) dev

mock: ## Serve the frontend against the in-browser Tauri mock
	@printf 'Open %s/?mock=tauri\n\n' '$(DEV_URL)'
	$(PNPM) dev

bundle: ## Build the installable app (.dmg / .msi / .AppImage)
	$(PNPM) tauri build

deps: ## Install the Node dependencies
	$(PNPM) install

# --- verification ---

verify: check test-ui test clippy test-e2e ## The full gate: everything below, fast first
	@printf '\n\033[32mAll green.\033[0m Live tests are separate: make test-live\n'

check: ## Type-check the frontend (must be 0 errors, 0 warnings)
	$(PNPM) check

test: ## Rust unit + integration tests
	cargo test --manifest-path $(CARGO_MANIFEST)

test-ui: ## Svelte component tests (vitest)
	$(PNPM) test:ui

test-e2e: ## End-to-end tests against the Tauri mock (Playwright)
	$(PNPM) test:e2e

test-e2e-ui: ## Same, in Playwright's inspector
	$(PNPM) exec playwright test --ui

# Excluded from `verify` on purpose: these reach the network, the Ollama
# daemon, and tools that are not installed everywhere. They are how the
# format writers and the MCP wire shapes were proven, so run them when
# touching either.
test-live: tools ## Rust tests that hit real tools, daemons and the network
	PATH="$(dir $(JAVA)):$$PATH" cargo test --manifest-path $(CARGO_MANIFEST) -- --ignored live_

clippy: ## Lint Rust. Shipped code must be clean; test code has known warnings
	cargo clippy --manifest-path $(CARGO_MANIFEST) -- -D warnings

lint: check clippy ## Static checks only, no tests

# Not part of `lint` or `verify`, and failing today by design: this codebase is
# hand-formatted wider than rustfmt's defaults and there is no rustfmt.toml, so
# `make fmt` reflows ~42 files. Decide that deliberately, not as a side effect.
fmt: ## Format the Rust sources (large diff — see the note in this Makefile)
	cargo fmt --manifest-path $(CARGO_MANIFEST)

fmt-check: ## Report what rustfmt would change (non-zero until fmt is adopted)
	cargo fmt --manifest-path $(CARGO_MANIFEST) -- --check

# --- utilities ---

mcp: ## Run Versorium as a stdio MCP server (read-only until granted in Settings)
	cargo run --manifest-path $(CARGO_MANIFEST) -- mcp

tools: ## Fetch epubcheck, which test-live needs and /tmp loses on reboot
	@if [ ! -f "$(EPUBCHECK_DIR)/epubcheck.jar" ]; then \
		printf 'Fetching epubcheck %s\n' '$(EPUBCHECK_VERSION)'; \
		mkdir -p /tmp/m5 && cd /tmp/m5 \
		&& curl -fsSL -o epubcheck.zip \
			'https://github.com/w3c/epubcheck/releases/download/v$(EPUBCHECK_VERSION)/epubcheck-$(EPUBCHECK_VERSION).zip' \
		&& unzip -qo epubcheck.zip && rm epubcheck.zip; \
	fi
	@test -x "$(JAVA)" || printf '\033[33mwarning:\033[0m no JDK at %s — the epubcheck test will fail\n' '$(JAVA)'

clean: ## Remove build output and test artefacts
	rm -rf dist test-results playwright-report
	cargo clean --manifest-path $(CARGO_MANIFEST)
