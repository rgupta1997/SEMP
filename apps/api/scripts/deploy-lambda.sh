#!/usr/bin/env bash
# One-shot / re-runnable deploy for the SEMP API to AWS Lambda + API Gateway
# (HTTP API), as an independent target alongside the existing Render deploy.
#
# Prereqs:
#   - AWS CLI v2, configured (`aws configure` or env creds) for the target account.
#   - `npm run build:lambda --workspace @semp/api` already run (produces dist-lambda.zip).
#   - apps/api/.env has DATABASE_URL / JWT_SECRET / WEB_ORIGIN (or export them
#     before running this script - it prefers already-exported values).
#
# Usage:
#   cd apps/api
#   npm run build:lambda
#   bash scripts/deploy-lambda.sh
#
# Safe to re-run: creates each resource only if missing, otherwise updates it
# (function code+config on redeploy, permission/route left alone once created).
set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-semp-api}"
API_NAME="${API_NAME:-semp-api-gateway}"
ROLE_NAME="${ROLE_NAME:-semp-api-lambda-role}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
MEMORY_MB="${MEMORY_MB:-512}"
TIMEOUT_SEC="${TIMEOUT_SEC:-15}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
ZIP_PATH="$API_DIR/dist-lambda.zip"

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "error: $ZIP_PATH not found - run 'npm run build:lambda --workspace @semp/api' first" >&2
  exit 1
fi

# On Git Bash, `aws` (aws.exe) is a native Windows binary - it can't resolve
# POSIX-style paths like /c/Workspace/.... Convert to a Windows path (still
# forward-slashed, which aws.exe accepts fine) for anything handed to `aws`.
# On real POSIX systems (Linux/macOS CI) `cygpath` won't exist, so fall back
# to the path unchanged there.
if command -v cygpath >/dev/null 2>&1; then
  ZIP_PATH_FOR_AWS="$(cygpath -m "$ZIP_PATH")"
else
  ZIP_PATH_FOR_AWS="$ZIP_PATH"
fi

# Pull DATABASE_URL / JWT_SECRET / WEB_ORIGIN from apps/api/.env if not already
# exported in this shell. Only these three matter to env.ts at runtime; PORT is
# ignored on Lambda (API Gateway owns the socket) and the SEED_ADMIN_* vars have
# safe defaults.
if [[ -f "$API_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$API_DIR/.env"
  set +a
fi
: "${DATABASE_URL:?DATABASE_URL not set (export it, or add it to apps/api/.env)}"
: "${JWT_SECRET:?JWT_SECRET not set (export it, or add it to apps/api/.env)}"
WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:5173}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "== account $ACCOUNT_ID, region $REGION =="

# ---------- 1. IAM execution role (basic CloudWatch Logs only - no VPC, no extra AWS access needed) ----------
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "== IAM role $ROLE_NAME already exists =="
else
  echo "== creating IAM role $ROLE_NAME =="
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{ "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" }]
    }' >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "== waiting for IAM role propagation (~10s) =="
  sleep 10
fi
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

ENV_JSON=$(cat <<JSON
{"Variables":{"DATABASE_URL":"${DATABASE_URL}","JWT_SECRET":"${JWT_SECRET}","WEB_ORIGIN":"${WEB_ORIGIN}"}}
JSON
)

# ---------- 2. Lambda function ----------
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "== updating existing function $FUNCTION_NAME =="
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --zip-file "fileb://${ZIP_PATH_FOR_AWS}" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --environment "$ENV_JSON" \
    --memory-size "$MEMORY_MB" --timeout "$TIMEOUT_SEC" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
else
  echo "== creating function $FUNCTION_NAME =="
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --runtime nodejs20.x --architectures x86_64 \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --zip-file "fileb://${ZIP_PATH_FOR_AWS}" \
    --memory-size "$MEMORY_MB" --timeout "$TIMEOUT_SEC" \
    --environment "$ENV_JSON" >/dev/null
  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
fi
FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

# ---------- 3. HTTP API (API Gateway v2) - $default route catches every path/method, same as Express does internally ----------
API_ID="$(aws apigatewayv2 get-apis --region "$REGION" \
  --query "Items[?Name=='${API_NAME}'].ApiId | [0]" --output text)"
if [[ "$API_ID" == "None" || -z "$API_ID" ]]; then
  echo "== creating HTTP API $API_NAME =="
  API_ID="$(aws apigatewayv2 create-api \
    --region "$REGION" \
    --name "$API_NAME" --protocol-type HTTP \
    --target "$FUNCTION_ARN" \
    --query ApiId --output text)"
  # Quick-create (--target) wires the integration + $default route + $default
  # auto-deploy stage, but does NOT grant API Gateway permission to invoke the
  # function - that has to be added explicitly below.
else
  echo "== HTTP API $API_NAME already exists (id $API_ID) =="
fi

# ---------- 4. Resource policy: allow this API to invoke the function ----------
if ! aws lambda get-policy --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null \
    | grep -q "\"${API_ID}/"; then
  echo "== granting API Gateway invoke permission =="
  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --statement-id "apigw-${API_ID}" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*" >/dev/null
fi

ENDPOINT="$(aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" --query ApiEndpoint --output text)"
echo ""
echo "== done =="
echo "Invoke URL: ${ENDPOINT}"
echo "Health check: curl ${ENDPOINT}/health"
echo "API base for the frontend: ${ENDPOINT}/api"
