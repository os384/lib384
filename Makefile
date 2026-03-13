# lib384/Makefile
# Build, test, and deploy the core lib384 library.
# Tests default to the local OrbStack stack; use *-dev variants for c3.384.dev.
# Local dev servers are managed from services/ — see services/Makefile.

.DEFAULT_GOAL := explain

DENO ?= deno

# ── Build ─────────────────────────────────────────────────────────────────────

build:
	$(DENO) task build

build-debug:
	$(DENO) task build:debug

clean:
	$(DENO) task clean

# ── Tests ─────────────────────────────────────────────────────────────────────

# [fast] tests against local OrbStack stack (default — requires local servers)
test: assert-local-up
	OS384_ENV=local $(DENO) task test:fast

# [fast] tests against c3.384.dev
test-dev:
	OS384_ENV=dev $(DENO) task test:fast

# Full test suite against local stack ([fast] + [channel] + [slow])
test-all: assert-local-up
	OS384_ENV=local $(DENO) task test

# Full test suite against c3.384.dev
test-all-dev:
	OS384_ENV=dev $(DENO) task test

# Channel tests only (tagged [channel]) — always needs a live stack
test-channel: assert-local-up
	OS384_ENV=local $(DENO) task test:channel

test-channel-dev:
	OS384_ENV=dev $(DENO) task test:channel

# ── Deploy ────────────────────────────────────────────────────────────────────

# Publish dist/ to 384.dev channel pages (credentials from env.js)
deploy: build
	OS384_ENV=dev $(DENO) task deploy

# ── Guards ────────────────────────────────────────────────────────────────────

# Verify local Wrangler workers are responding before running local tests.
# Start them first with 'make dev-storage' and 'make dev-channel' in services/.
assert-local-up:
	@curl --max-time 2 -s -o /dev/null http://localhost:3845/ 2>/dev/null || \
	  (echo "ERROR: channel server not responding at localhost:3845 -- run 'make dev-channel' in services/" && false)
	@curl --max-time 2 -s -o /dev/null http://localhost:3843/ 2>/dev/null || \
	  (echo "ERROR: storage server not responding at localhost:3843 -- run 'make dev-storage' in services/" && false)
	@echo "Local stack OK (channel :3845, storage :3843)"

# ── Composite targets ─────────────────────────────────────────────────────────

all-local: assert-local-up build test
	@echo "Build + test against local stack: done"

all-dev: build test-dev
	@echo "Build + test against c3.384.dev: done"

# ── Help ──────────────────────────────────────────────────────────────────────

explain:
	@echo ""
	@echo "lib384 — build, test, deploy"
	@echo ""
	@echo "Build:"
	@echo "  build             Production bundles (dist/384.esm.js, .iife.js, .sw.js)"
	@echo "  build-debug       With sourcemaps, no minification"
	@echo "  clean             Remove dist/"
	@echo ""
	@echo "Test (set OS384_ENV to override target stack):"
	@echo "  test              [fast] against local OrbStack stack  (requires local servers)"
	@echo "  test-dev          [fast] against c3.384.dev"
	@echo "  test-all          Full suite against local stack"
	@echo "  test-all-dev      Full suite against c3.384.dev"
	@echo "  test-channel      [channel] only against local stack"
	@echo "  test-channel-dev  [channel] only against c3.384.dev"
	@echo ""
	@echo "  You can also pass OS384_ENV directly:"
	@echo "    OS384_ENV=local deno task test:fast"
	@echo ""
	@echo "Deploy:"
	@echo "  deploy            Build then publish dist/ to 384.dev channel pages"
	@echo ""
	@echo "Composite:"
	@echo "  all-local         build + test against local stack"
	@echo "  all-dev           build + test against c3.384.dev"
	@echo ""
	@echo "Guards:"
	@echo "  assert-local-up   Check channel (:3845) and storage (:3843) are responding"
	@echo ""
	@echo "Local dev servers are managed from services/ — see services/Makefile."
	@echo ""
