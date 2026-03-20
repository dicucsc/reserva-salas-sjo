#!/bin/bash
set -e
cd "$(dirname "$0")"

TOKEN="5a866b962f23bd211594bf168b121ee1edfb942797a6b12915eceac8c3c13a6106-e5d83e34-058c-46ff-80b0-25f53a9bd26e01013180d4ee9a10"

# Auto-generate unique cache buster (timestamp)
BUILD_VERSION=$(date +%s)
echo "Build version: $BUILD_VERSION"
sed -i "s/?v=[0-9]*/?v=$BUILD_VERSION/g" index.html
echo "Cache busters updated to ?v=$BUILD_VERSION"

# Instalar deps del API (node_modules se sube con SKIP_API_BUILD=true)
cd api && npm install --omit=dev && cd ..

# Deploy desde directorio PADRE (evita bug de paths de swa deploy)
cd D:/Research

DEPLOYMENT_TOKEN="$TOKEN" \
DEPLOYMENT_ACTION="upload" \
DEPLOYMENT_PROVIDER="SwaCli" \
REPOSITORY_BASE="D:\\Research\\Reserva_salas_SJO" \
SKIP_APP_BUILD="true" \
SKIP_API_BUILD="true" \
APP_LOCATION="." \
API_LOCATION="api" \
OUTPUT_LOCATION="." \
CONFIG_FILE_LOCATION="." \
FUNCTION_LANGUAGE="node" \
FUNCTION_LANGUAGE_VERSION="20" \
"$HOME/.swa/deploy/08e29138cd3dcda4ffda6d587aa580028110c1c7/StaticSitesClient.exe"

echo "Deploy complete. Build version: $BUILD_VERSION"
