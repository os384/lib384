# lib384/Makefile
# Build, test, and deploy the core lib384 library.
# Tests auto-detect local OrbStack stack (ports 3845/3843); fall back to c3.384.dev if not up.
# Local dev servers are managed from services/ — see services/Makefile.

.DEFAULT_GOAL := explain

DENO ?= deno

# Auto-detect: use local stack if both servers respond, otherwise fall back to dev (staged).
# This runs once at parse time and is passed to deno tasks via OS384_ENV.
OS384_ENV := $(shell (curl --max-time 1 -s -o /dev/null http://localhost:3845/ && \
                      curl --max-time 1 -s -o /dev/null http://localhost:3843/) 2>/dev/null \
                     && echo local || echo dev)

# ── Build ─────────────────────────────────────────────────────────────────────

build:
	$(DENO) task build

build-debug:
	$(DENO) task build:debug

clean:
	$(DENO) task clean

# ── Tests ─────────────────────────────────────────────────────────────────────

# [fast] tests — auto-selects local or dev
test-fast:
	@echo "Target stack: $(OS384_ENV)"
	OS384_ENV=$(OS384_ENV) $(DENO) task test:fast

# Full suite ([fast] + [channel] + [slow]) — auto-selects local or dev
test:
	@echo "Target stack: $(OS384_ENV)"
	OS384_ENV=$(OS384_ENV) $(DENO) task test

# ── Deploy ────────────────────────────────────────────────────────────────────

# Publish dist/ to 384.dev channel pages (credentials from env.js)
deploy: build
	OS384_ENV=dev $(DENO) task deploy

# ── Composite targets ─────────────────────────────────────────────────────────

all: build test
	@echo "Build + test: done (stack: $(OS384_ENV))"

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
	@echo "Test (auto-detects local stack; falls back to c3.384.dev if not up):"
	@echo "  test-fast         [fast] tests — local if up, else dev"
	@echo "  test              Full suite — local if up, else dev"
	@echo ""
	@echo "Deploy:"
	@echo "  deploy            Build then publish dist/ to 384.dev channel pages"
	@echo ""
	@echo "Composite:"
	@echo "  all               build + test"
	@echo ""
	@echo "Local dev servers are managed from services/ — see services/Makefile."
	@echo ""
