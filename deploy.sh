#!/bin/bash
# Deploy directo a Azure Static Web Apps (sin GitHub)
# Uso: ./deploy.sh

set -e
cd "$(dirname "$0")"

# Preparar carpeta dist con frontend
rm -rf dist
mkdir -p dist
cp -r index.html css js staticwebapp.config.json dist/

# Deploy
DEPLOYMENT_ACTION=upload \
DEPLOYMENT_PROVIDER=SwaCli \
REPOSITORY_BASE="$(pwd)" \
SKIP_APP_BUILD=true \
SKIP_API_BUILD=true \
DEPLOYMENT_TOKEN=5a866b962f23bd211594bf168b121ee1edfb942797a6b12915eceac8c3c13a6106-e5d83e34-058c-46ff-80b0-25f53a9bd26e01013180d4ee9a10 \
APP_LOCATION="dist" \
API_LOCATION="api" \
CONFIG_FILE_LOCATION="dist" \
FUNCTION_LANGUAGE=node \
FUNCTION_LANGUAGE_VERSION=18 \
"$HOME/.swa/deploy/08e29138cd3dcda4ffda6d587aa580028110c1c7/StaticSitesClient.exe" upload

# Limpiar
rm -rf dist
