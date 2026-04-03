# (c) 384

.DEFAULT_GOAL := explain

DENO = deno
DENO_FLAGS = --no-config --allow-all --no-npm --no-lock

KEYS_FILE := $(HOME)/.os384/keys.js

CLI_SRC_DIR = cli.tools
CLI_SRCS = $(wildcard $(CLI_SRC_DIR)/384.ts) dist/384.esm.js dist/384.esm.d.ts Makefile
CLI_BIN_DIR = bin
CLI_TARGET = $(CLI_BIN_DIR)/384

cli: $(CLI_TARGET)

$(CLI_TARGET): $(CLI_SRCS)
	@mkdir -p $(CLI_BIN_DIR)
	$(DENO) compile $(DENO_FLAGS) -o $@ $<

deployCLI: cli
	@echo **** WARNING CLI deployment not yet implemented ****

# note: these will deploy to local or staging depending on env.js
deployLib384: deployCLI
	cd dist && \
	../cli.tools/publish.page.ts -f 384.esm.js -k $$sb384_lib384_esm && \
	../cli.tools/publish.page.ts -f 384.iife.js -k $$sb384_lib384_iife && \
	../cli.tools/publish.page.ts -f 384.esm.d.ts -k $$sb384_lib384_types

# note: these will deploy to local or staging depending on env.js
deployLoader:
	cd demos/13.app.loader && \
	../../cli.tools/publish.page.ts -f index.js -k $$sb384_appLoaderLib

deployAll: deployLib384 deployLoader

deployLib: deployLib384

assert-local:
	@grep "serverType" env.js | grep -q "'local'" || (echo "Error: serverType in 'env.js' must be set to 'local'" && false)

assert-staging:
	@grep "serverType" env.js | grep -q "'dev'" || (echo "Error: serverType 'env.js' must be set to 'dev'" && false)

buildLib384:
	yarn build

# the loader is different for local and staging
# (it pulls it's 'index.js' from either local or staging servers)
buildLoaderLocal: assert-local
	cd demos && yarn 13:local

buildLoaderStaging: assert-staging
	cd demos && yarn 13:staging

buildLocal: assert-local buildLib384 buildLoaderLocal buildSWdbg

buildStaging: assert-staging buildLib384 buildLoaderStaging buildSW

sw buildSW:
	yarn sw

buildSWdbg:
	yarn sw:debug

# only 'fast' test actually fully terminates, most non-fast are intended for interactive use
test: cli
	yarn test:fast

# loader no longer deployed to staging from lib384 but from separate repo
all-staging: assert-staging cli buildStaging buildSW test deployLib
	@echo "Finished building and testing and deploying to STAGING"

# note: this deploys older loader to local
all-local: assert-local cli buildLocal buildSW test deployAll
	@echo "Finished building and testing and deploying to LOCAL"

all-no-test: assert-local cli buildLocal buildSW deploy
	@echo "Finished building and deploying to LOCAL"

explain:
	@echo
	@echo "Full targets:"
	@echo
	@echo "  all-local    - Runs build, test, and deploy targets (for LOCAL and debug settings)"
	@echo "  all-staging  - Runs build, test, and deploy targets (for STAGING and minified settings)"
	@echo "  all-no-test  - Runs build and deploy targets for LOCAL/debug, but does not run any tests"
	@echo
	@echo "Sub-targets for building, testing, and deploying:"
	@echo
	@echo "  buildLib384  - Compiles the library"
	@echo "  buildLocal   - Compiles the library, types file, loader, and SW for local dev"
	@echo "  buildStaging - Compiles the library, types file, loader, and SW for staging"
	@echo
	@echo "  test         - Runs the test suite ('fast' subset)"
	@echo
	@echo "                 Note: set matching deploy target 'env.js' ('local'|'staging')"
	@echo "  deploy       - Publish/deploy the library and loader"
	@echo "  deployLib384 - Deploys just the library (384)"
	@echo "  deployLoader - Deploys just the loader"
	@echo
	@echo "  sw           - Builds just the service worker"
	@echo
	@echo "  cli          - Builds the CLI by itself ('bin/384')"
	@echo
	@echo "Note: service-worker, channel server, and storage server deploy elsewhere"
	@echo
