# Invoked by `sam build` for the SempApiFunction resource in infra/semp-api.yaml
# (Metadata.BuildMethod: makefile, CodeUri: ../apps/api). SAM runs the target below
# with the working directory set to THIS directory and ARTIFACTS_DIR set to an
# absolute path under .aws-sam/build/SempApiFunction. Everything that must ship has
# to end up in ARTIFACTS_DIR; SAM zips and content-hashes it, which is why
# scripts/build-lambda.mjs skips its own `zip` step when ARTIFACTS_DIR is set.
#
# ---------------------------------------------------------------------------
# REQUIRES build_in_source. Never `sam build --use-container`.
# ---------------------------------------------------------------------------
# `sam build` runs CustomMakeBuilder:CopySource by DEFAULT: it copies CodeUri to a
# scratch directory under .aws-sam/ and runs this Makefile there. That breaks the
# build, so infra/samconfig.toml sets `build_in_source = true` for the api config
# env, which runs it in the real apps/api instead.
#
# Do not remove that flag. Without it the build fails on
# `../../node_modules/.bin/prisma: No such file or directory`, for two independent
# reasons, both fatal:
#
#   1. The esbuild bundle resolves @semp/shared, @semp/entitlements and
#      @semp/notifications straight out of ../../packages/*/src/*.ts. Those packages
#      have NO compiled output - their package.json "main" points at a .ts file - so
#      only a bundler can resolve them, and only if the monorepo root is on disk.
#
#   2. @prisma/client and .prisma/client are hoisted by npm workspaces to
#      ../../node_modules; apps/api/node_modules contains only esbuild.
#      scripts/build-lambda.mjs probes both locations and throws if neither has them.
#
# A scratch copy of apps/api - or a build container, which mounts even less - has
# neither, so the build fails there in a way that looks like a Prisma problem and is
# not. (`npx prisma` makes it worse: with no local copy to find it silently installs
# prisma@7 from the registry, which rejects `url` in the datasource block, so the
# error names this repo's schema rather than the missing directory.)
#
# ---------------------------------------------------------------------------
# Three functions, three targets, one Makefile
# ---------------------------------------------------------------------------
# SAM invokes `build-<LogicalId>` per function resource, so the two small realtime
# Lambdas live here beside the API rather than in a separate package. They share
# apps/api's CodeUri (and so its build_in_source requirement and its workspace
# resolution) but NOT its build script: scripts/build-fn.mjs bundles a single file
# with no Prisma at all, because neither of them touches a database.
#
# The MAX_BUNDLE_KB values are load-bearing, not cosmetic, and each was calibrated by
# experiment rather than guessed - a budget too loose to fire is no budget at all:
#
#   authorizer  140 KB clean, 279 KB with one `import { env } from config/env.js`
#               -> budget 200 KB
#   publisher   335 KB clean (SigV4 + sha256), 474 KB with the same bad import
#               -> budget 400 KB
#
# They turn "someone imported half the application into a function on AppSync's
# connect path" from an invisible latency regression into a failed build. Raise them
# only for growth you actually intended, and re-measure when you do.
SHELL := /bin/bash
.PHONY: build-SempApiFunction build-RealtimeAuthorizerFunction build-RealtimePublisherFunction

build-SempApiFunction:
	# The HOISTED, PINNED binary - explicitly, NOT `npx prisma`.
	#
	# `npx prisma` under sam build does not resolve the workspace copy: apps/api's
	# own node_modules holds only esbuild, and npx fetched prisma@7 from the registry
	# instead of using the repo's 5.22.0. Prisma 7 removed `url` from the datasource
	# block, so the build failed with a schema validation error that had nothing to
	# do with this repo's schema.
	#
	# Generates BOTH engines named in prisma/schema.prisma binaryTargets - "native"
	# for local dev and this build's own tooling, plus the Lambda target - into the
	# hoisted ../../node_modules/.prisma/client. Mutating that shared directory is
	# intended: "native" is preserved, so local dev keeps working afterwards.
	../../node_modules/.bin/prisma generate --schema prisma/schema.prisma
	# PRISMA_ENGINE_TARGET must match Architectures: in infra/semp-api.yaml. It is
	# set here so the architecture is chosen in exactly one place.
	PRISMA_ENGINE_TARGET=linux-arm64-openssl-3.0.x \
	ARTIFACTS_DIR="$(ARTIFACTS_DIR)" \
	  node scripts/build-lambda.mjs
	# The Prisma query engine is a native binary that Lambda must be able to execute
	# from /var/task. Asserted rather than discovered later as a runtime permission
	# error, and re-applied here because SAM's zip step is what has historically
	# dropped mode bits.
	chmod 755 "$(ARTIFACTS_DIR)"/node_modules/.prisma/client/libquery_engine-*.node

build-RealtimeAuthorizerFunction:
	# No Prisma, no env schema, no routers - see the budget note above.
	ENTRY=src/realtime-authorizer.ts MAX_BUNDLE_KB=200 \
	ARTIFACTS_DIR="$(ARTIFACTS_DIR)" \
	  node scripts/build-fn.mjs

build-RealtimePublisherFunction:
	# No Prisma and no Secrets extension - this function authorizes with its IAM
	# role, so it has no token to fetch and nothing to read from the database.
	ENTRY=src/realtime-publisher.ts MAX_BUNDLE_KB=400 \
	ARTIFACTS_DIR="$(ARTIFACTS_DIR)" \
	  node scripts/build-fn.mjs
