# Deploy a Azure Static Web Apps sin GitHub

## Requisitos previos (ya instalados)

- Node.js
- `@azure/static-web-apps-cli` (`npm install -g @azure/static-web-apps-cli`) — se usa solo para descargar el binario `StaticSitesClient.exe`
- El binario queda en `~/.swa/deploy/<buildId>/StaticSitesClient.exe`

## Por qué no se usa `swa deploy` directamente

El SWA CLI en Windows tiene un bug: convierte `APP_LOCATION` a ruta absoluta y el `StaticSitesClient.exe` la concatena con `REPOSITORY_BASE`, generando paths inválidos como `D:\proyecto\D:\proyecto`. La solución es llamar al `StaticSitesClient.exe` directamente pasando las variables de entorno correctas.

## Por qué se necesita una carpeta `dist/`

`StaticSitesClient.exe` no permite que `APP_LOCATION` sea el directorio actual (error: "Current directory cannot be identical to or contained within artifact folders"). Se debe copiar el frontend a una subcarpeta temporal `dist/`.

## Configuración requerida en `staticwebapp.config.json`

El archivo DEBE incluir la sección `platform` con el runtime de la API:

```json
{
  "platform": {
    "apiRuntime": "node:18"
  }
}
```

Sin esto, el deploy de las Azure Functions falla con "Function language info isn't provided".

## Comando de deploy

Ejecutar desde la raíz del proyecto:

```bash
bash deploy.sh
```

## Qué hace `deploy.sh`

1. Crea carpeta `dist/` con los archivos del frontend: `index.html`, `css/`, `js/`, `staticwebapp.config.json`
2. Llama a `StaticSitesClient.exe upload` con estas variables de entorno:
   - `REPOSITORY_BASE` = directorio del proyecto (ruta absoluta)
   - `APP_LOCATION` = `dist` (relativa a REPOSITORY_BASE)
   - `API_LOCATION` = `api` (relativa a REPOSITORY_BASE)
   - `CONFIG_FILE_LOCATION` = `dist` (donde está staticwebapp.config.json)
   - `DEPLOYMENT_TOKEN` = token del Static Web App
   - `FUNCTION_LANGUAGE` = `node`
   - `FUNCTION_LANGUAGE_VERSION` = `18`
   - `SKIP_APP_BUILD` = `true` (no hay paso de build, es vanilla JS)
   - `SKIP_API_BUILD` = `true` (dependencias ya están en api/node_modules)
3. Limpia `dist/`

## Obtener el deployment token

Azure Portal → Static Web Apps → tu app → **Manage deployment token** → Copy

## Obtener el buildId del StaticSitesClient

```bash
ls ~/.swa/deploy/
```

Si no existe, ejecutar `swa deploy` una vez para que descargue el binario.

## Para replicar en otro proyecto

### Estructura mínima requerida

```
proyecto/
├── index.html
├── css/
├── js/
├── staticwebapp.config.json    ← DEBE tener platform.apiRuntime
├── api/
│   ├── host.json
│   ├── package.json
│   ├── package-lock.json
│   ├── node_modules/           ← ejecutar cd api && npm install
│   ├── shared/
│   └── functions/
└── deploy.sh
```

### Crear `deploy.sh` para el nuevo proyecto

Copiar `deploy.sh` y cambiar:
1. `DEPLOYMENT_TOKEN` — token del nuevo Static Web App
2. La línea de `cp` si el frontend tiene archivos diferentes (ej: agregar `images/`, `fonts/`, etc.)
3. El path al `StaticSitesClient.exe` si el buildId cambió

### Antes del primer deploy

```bash
cd api && npm install && cd ..
```

### Verificar deploy exitoso

La salida debe mostrar:
```
Status: Succeeded
Deployment Complete :)
Visit your site at: https://xxxxx.azurestaticapps.net
```

## Troubleshooting

| Error | Causa | Solución |
|-------|-------|----------|
| "Function language info isn't provided" | Falta `platform.apiRuntime` en staticwebapp.config.json | Agregar `"platform": { "apiRuntime": "node:18" }` |
| "Current directory cannot be identical to artifact folders" | APP_LOCATION apunta al directorio actual | Usar carpeta `dist/` separada |
| Path duplicado `D:\x\D:\x` | Bug del SWA CLI en Windows | Usar StaticSitesClient.exe directo con env vars |
| "An unknown exception has occurred" | Generalmente el path duplicado | Verificar que APP_LOCATION sea relativo |
| API retorna respuesta vacía (HTTP 404) | Functions no se deployaron | Verificar FUNCTION_LANGUAGE y que api/node_modules exista |
