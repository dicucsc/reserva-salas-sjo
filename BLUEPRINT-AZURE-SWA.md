# Blueprint: Aplicacion Web con Azure Static Web Apps

> Documento optimizado para LLM. Contiene toda la informacion necesaria para replicar la arquitectura de este proyecto (Reserva de Salas SJO) en un proyecto nuevo.

---

## 1. STACK TECNOLOGICO

| Capa | Tecnologia | Version |
|------|-----------|---------|
| Frontend | HTML + CSS + Vanilla JS + Bootstrap | 5.3.3 |
| Backend | Azure Functions (Node.js v4 programming model) | @azure/functions ^4.0.0 |
| Base de datos | Azure Table Storage | @azure/data-tables ^13.0.0 |
| Autenticacion | Microsoft Entra ID (Azure AD) via SWA built-in auth | OAuth 2.0 / OpenID Connect |
| Hosting | Azure Static Web Apps (SWA) | Free/Standard tier |
| CI/CD | GitHub Actions (auto-generado por SWA) | azure-static-web-apps-deploy@v1 |

---

## 2. ESTRUCTURA DE DIRECTORIO

```
proyecto/
├── .github/
│   └── workflows/
│       └── azure-static-web-apps.yml   # CI/CD auto-deploy on push to master
├── api/                                 # Azure Functions backend
│   ├── functions/                       # Cada archivo = 1 endpoint HTTP
│   │   ├── fullInit.js                  # GET  /api/fullInit
│   │   ├── getUserProfile.js            # GET  /api/getUserProfile
│   │   ├── getYearCompact.js            # GET  /api/getYearCompact?year=2026
│   │   ├── createReservation.js         # POST /api/createReservation
│   │   ├── updateReservation.js         # POST /api/updateReservation
│   │   ├── cancelReservation.js         # POST /api/cancelReservation
│   │   ├── cancelRecurrenceGroup.js     # POST /api/cancelRecurrenceGroup
│   │   └── adminConfig.js              # POST /api/adminConfig
│   ├── shared/
│   │   ├── auth.js                      # Parsea x-ms-client-principal header
│   │   └── tableClient.js              # Wrapper Azure Table Storage
│   ├── host.json
│   ├── package.json
│   └── package-lock.json
├── js/
│   ├── auth.js                          # Frontend auth (/.auth/me, /login, /logout)
│   ├── api.js                           # Cliente HTTP (fetch wrapper)
│   ├── calendar.js                      # Logica de calendario/grilla
│   └── app.js                           # App principal, navegacion, modals, config
├── css/
│   └── styles.css
├── scripts/
│   ├── migrate-to-azure.js             # Migra CSV → Azure Table Storage
│   └── package.json
├── data/                                # CSVs para migracion
├── index.html                           # SPA entry point
├── staticwebapp.config.json            # Config SWA: auth + routes
└── .gitignore
```

---

## 3. CUENTA MICROSOFT Y RECURSOS AZURE

### 3.1 Que necesitas

1. **Cuenta Microsoft** con suscripcion Azure activa (Free tier sirve para empezar)
2. **Repositorio GitHub** conectado a Azure Static Web Apps

### 3.2 Recursos Azure a crear

| Recurso | Proposito |
|---------|-----------|
| **Static Web App** | Hosting frontend + API Functions integradas |
| **Storage Account** | Azure Table Storage (base de datos NoSQL) |
| **App Registration (Entra ID)** | Autenticacion con cuentas Microsoft/organizacionales |

### 3.3 Paso a paso: Crear recursos

#### A) Storage Account + Table Storage

```bash
# En Azure Portal o CLI:
az storage account create \
  --name mistorageaccount \
  --resource-group mi-resource-group \
  --location eastus \
  --sku Standard_LRS

# Obtener connection string (guardar para despues):
az storage account show-connection-string \
  --name mistorageaccount \
  --resource-group mi-resource-group
```

Las tablas se crean automaticamente con el script de migracion, o manualmente:
- `Salas`, `Bloques`, `Usuarios`, `Equipos`, `Reservas`, `ReservaEquipos`

#### B) Static Web App

1. Azure Portal → Create Resource → Static Web App
2. Conectar con repositorio GitHub (rama `master`)
3. Build config:
   - **App location**: `/`
   - **API location**: `api`
   - **Output location**: `/`
   - **Skip app build**: `true` (no hay framework frontend)
4. Al crear, Azure genera automaticamente:
   - GitHub Action workflow (`.github/workflows/azure-static-web-apps.yml`)
   - Secret `AZURE_STATIC_WEB_APPS_API_TOKEN` en GitHub

#### C) App Registration (Entra ID) para autenticacion

1. Azure Portal → Microsoft Entra ID → App Registrations → New Registration
2. Configurar:
   - **Name**: "Mi App Web"
   - **Supported account types**: "Accounts in this organizational directory only" (para tenant unico) o "Any organizational directory" (multi-tenant)
   - **Redirect URI**: `https://tu-app.azurestaticapps.net/.auth/login/aad/callback`
3. Anotar:
   - **Application (client) ID** → sera `AAD_CLIENT_ID`
   - **Directory (tenant) ID** → va en `openIdIssuer`
4. Certificates & Secrets → New client secret → copiar valor → sera `AAD_CLIENT_SECRET`
5. En Azure Static Web App → Configuration → Application Settings, agregar:
   - `AAD_CLIENT_ID` = (client ID del paso 3)
   - `AAD_CLIENT_SECRET` = (secret del paso 4)
   - `AZURE_STORAGE_CONNECTION_STRING` = (connection string del Storage Account)

---

## 4. CONFIGURACION: staticwebapp.config.json

Este archivo controla autenticacion, rutas y comportamiento de SWA.

```json
{
  "auth": {
    "identityProviders": {
      "azureActiveDirectory": {
        "registration": {
          "openIdIssuer": "https://login.microsoftonline.com/{TENANT_ID}/v2.0",
          "clientIdSettingName": "AAD_CLIENT_ID",
          "clientSecretSettingName": "AAD_CLIENT_SECRET"
        }
      }
    }
  },
  "routes": [
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/login",
      "rewrite": "/.auth/login/aad"
    },
    {
      "route": "/logout",
      "rewrite": "/.auth/logout"
    }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/login"
    }
  },
  "navigationFallback": {
    "rewrite": "/index.html"
  }
}
```

**Puntos clave:**
- `clientIdSettingName` y `clientSecretSettingName` son **nombres de variables de entorno**, no los valores directos
- `openIdIssuer` contiene el **Tenant ID** de tu directorio Entra ID
- Todas las rutas `/api/*` requieren autenticacion
- `/login` y `/logout` son rewrites a los endpoints built-in de SWA
- `navigationFallback` redirige todas las rutas 404 a `index.html` (SPA)

---

## 5. GITHUB ACTIONS: CI/CD

Archivo `.github/workflows/azure-static-web-apps.yml`:

```yaml
name: Azure Static Web Apps CI/CD

on:
  push:
    branches:
      - master
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - master

jobs:
  build_and_deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy
    steps:
      - uses: actions/checkout@v4
      - name: Build And Deploy
        id: builddeploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/"
          api_location: "api"
          output_location: "/"
          skip_app_build: true

  close_pull_request:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    name: Close Pull Request
    steps:
      - name: Close Pull Request
        id: closepullrequest
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: "close"
```

**Flujo:**
1. Push a `master` → deploy automatico
2. Pull Request → deploy a staging environment
3. PR cerrado → staging eliminado
4. `skip_app_build: true` porque no hay paso de build (vanilla JS)

---

## 6. AUTENTICACION: FLUJO COMPLETO

### 6.1 Frontend: `js/auth.js`

```javascript
const Auth = {
  _cachedPrincipal: undefined,

  async getUserInfo() {
    if (this._cachedPrincipal !== undefined) return this._cachedPrincipal;
    try {
      const res = await fetch('/.auth/me');
      const data = await res.json();
      this._cachedPrincipal = data.clientPrincipal || null;
    } catch {
      this._cachedPrincipal = null;
    }
    return this._cachedPrincipal;
  },

  login() { window.location.href = '/login'; },
  logout() { this._cachedPrincipal = undefined; window.location.href = '/logout'; },
  async isAuthenticated() { return !!(await this.getUserInfo()); },
  clearCache() { this._cachedPrincipal = undefined; }
};
```

**Endpoints built-in de SWA:**
- `/.auth/me` → retorna `{ clientPrincipal: { userId, userDetails, identityProvider, userRoles } }`
- `/.auth/login/aad` → redirect a Microsoft login
- `/.auth/logout` → cierra sesion

### 6.2 Backend: `api/shared/auth.js`

```javascript
function getClientPrincipal(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch { return null; }
}

function getUserEmail(request) {
  const principal = getClientPrincipal(request);
  if (!principal) return null;
  return principal.userDetails ? principal.userDetails.toLowerCase().trim() : null;
}

module.exports = { getClientPrincipal, getUserEmail };
```

**Como funciona:**
1. Usuario no autenticado visita `/api/*` → SWA retorna 401 → redirect a `/login`
2. Usuario hace login con Microsoft → SWA inyecta header `x-ms-client-principal` en requests a `/api/*`
3. El backend decodifica el header (base64 → JSON) para obtener email
4. Email se valida contra tabla `Usuarios` para verificar que esta registrado

---

## 7. BASE DE DATOS: Azure Table Storage

### 7.1 Wrapper: `api/shared/tableClient.js`

```javascript
const { TableClient, odata } = require('@azure/data-tables');
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

function getTableClient(tableName) {
  return TableClient.fromConnectionString(connectionString, tableName);
}

// Operaciones disponibles:
async function getAll(tableName) { /* scan completo */ }
async function getByPartition(tableName, partitionKey) { /* query por PK */ }
async function getByPartitionRange(tableName, pkStart, pkEnd) { /* rango PK */ }
async function getEntity(tableName, partitionKey, rowKey) { /* lookup directo O(1) */ }
async function upsertEntity(tableName, entity) { /* insert o update */ }
async function deleteEntity(tableName, partitionKey, rowKey) { /* eliminar */ }
async function batchUpsert(tableName, entities) { /* batch max 100, mismo PK */ }
async function batchDelete(tableName, keys) { /* batch delete */ }
```

### 7.2 Schema de tablas

**Tablas de configuracion** (partition key fija, pocos registros):

```
Tabla: Salas
  partitionKey: "salas"
  rowKey: "1", "2", "3"...  (ID como string)
  Campos: Nombre (string), Capacidad (number)

Tabla: Bloques
  partitionKey: "bloques"
  rowKey: "1", "2"...
  Campos: HoraInicio (string "HH:MM"), HoraFin (string), Etiqueta (string)

Tabla: Equipos
  partitionKey: "equipos"
  rowKey: "1", "2"...
  Campos: Nombre (string), Descripcion (string), Cantidad (number)

Tabla: Usuarios
  partitionKey: "usuarios"
  rowKey: email (lowercase)  ← el email ES la clave
  Campos: Nombre (string), Rol (string: "admin"|"profesor"|"user")
```

**Tablas transaccionales** (particionadas por mes para consultas eficientes):

```
Tabla: Reservas
  partitionKey: "YYYY-MM" (ej: "2026-03")
  rowKey: ID unico (timestamp-based)
  Campos: SalaID, Fecha, BloqueID, Email, Nombre,
          Actividad, Recurrencia, CreatedAt, Comentarios,
          Equipos (comma-separated IDs), Responsable

Tabla: ReservaEquipos  (denormalizada para disponibilidad rapida)
  partitionKey: "YYYY-MM"
  rowKey: "{ReservaID}_{EquipoID}"
  Campos: ReservaID, EquipoID, NombreEquipo, Fecha,
          BloqueID, SalaID, NombreSala, Responsable
```

### 7.3 Patrones de diseno de Table Storage

- **PartitionKey = clave de consulta principal**. Table Storage es O(1) por PartitionKey. Disenar PK segun las consultas mas frecuentes.
- **Datos de config**: PK fija ("salas", "bloques"), pocos registros → scan barato
- **Datos transaccionales**: PK por mes ("2026-03") → consulta de un anio = 12 partition scans
- **Denormalizacion**: `ReservaEquipos` duplica datos para evitar JOINs (Table Storage no tiene JOINs)
- **Batch operations**: Maximo 100 entidades por batch, DEBEN compartir PartitionKey
- **IDs**: `Date.now() * 1000 + Math.floor(Math.random() * 1000)` → unico sin autoincrement

---

## 8. BACKEND: Azure Functions Node.js v4

### 8.1 Configuracion

**`api/host.json`:**
```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

**`api/package.json`:**
```json
{
  "name": "mi-app-api",
  "version": "1.0.0",
  "private": true,
  "main": "functions/*.js",
  "dependencies": {
    "@azure/functions": "^4.0.0",
    "@azure/data-tables": "^13.0.0"
  }
}
```

### 8.2 Patron de cada funcion

```javascript
const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const { getEntity, upsertEntity } = require('../shared/tableClient');

app.http('nombreFuncion', {
  methods: ['GET'],           // o ['POST']
  authLevel: 'anonymous',     // SWA maneja auth, no la funcion
  route: 'nombreFuncion',
  handler: async (request, context) => {
    try {
      // 1. Obtener email del usuario autenticado
      const email = getUserEmail(request);
      if (!email) {
        return { status: 401, jsonBody: { ok: false, error: 'No autenticado' } };
      }

      // 2. Logica de negocio
      const data = await getEntity('MiTabla', 'pk', 'rk');

      // 3. Respuesta estandar
      return { jsonBody: { ok: true, data: { ... } } };
    } catch (err) {
      context.error('nombreFuncion error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
```

**Convencion de respuesta:**
- Exito: `{ ok: true, data: { ... } }`
- Error: `{ ok: false, error: "mensaje" }` + HTTP status code

### 8.3 Formato compacto para datos masivos

Para enviar muchas reservas al frontend sin explotar el ancho de banda:

```javascript
// Backend: buildYearCompact(year)
// Indexa strings repetidos en arrays, referencia por indice
{
  y: 2026,                                    // year
  u: [["email@ex.com","Juan"],...],           // users (dedup)
  a: ["Reunion","Taller",...],                // activities (dedup)
  g: ["REC-123",...],                         // recurrence groups
  c: ["Comentario 1",...],                    // comments
  p: ["Responsable 1",...],                   // responsables
  r: [                                        // records
    [id, salaId, dayOfYear, bloqueId, userIdx, actIdx, groupIdx, commentIdx, equipStr, respIdx],
    ...
  ]
}

// Frontend: expandCompact(compact) → array de objetos normales
```

---

## 9. FRONTEND: PATRON SPA VANILLA

### 9.1 Cliente API: `js/api.js`

```javascript
const API_URL = '/api';

const Api = {
  _timeout: 15000,

  async _get(endpoint, params) {
    const url = new URL(API_URL + '/' + endpoint, window.location.origin);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (res.status === 401) { Auth.login(); throw new Error('No autenticado'); }
      return res.json();
    } finally { clearTimeout(timer); }
  },

  async _post(endpoint, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    try {
      const res = await fetch(API_URL + '/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (res.status === 401) { Auth.login(); throw new Error('No autenticado'); }
      return res.json();
    } finally { clearTimeout(timer); }
  },

  // Endpoints:
  fullInit: () => Api._get('fullInit'),
  getUserProfile: () => Api._get('getUserProfile'),
  getYearCompact: (year) => Api._get('getYearCompact', { year }),
  createReservation: (data) => Api._post('createReservation', data),
  cancelReservation: (id, fecha) => Api._post('cancelReservation', { reservaId: id, fecha }),
  updateReservation: (data) => Api._post('updateReservation', data),
  adminConfig: (resource, action, data) => Api._post('adminConfig', { resource, action, data: data || {} })
};
```

### 9.2 Navegacion SPA

```javascript
// Multiples <section class="view-section d-none"> en index.html
// Cambiar vista:
showView(name) {
  document.querySelectorAll('.view-section').forEach(v => v.classList.add('d-none'));
  document.getElementById('view-' + name).classList.remove('d-none');
  // Actualizar nav activo y cargar datos de la vista
}
```

### 9.3 Seguridad frontend

- `escapeHtml(str)` para todo contenido dinamico (prevenir XSS)
- 401 en cualquier API → redirect automatico a login
- Cache-bust con `?v=N` en `<script>` y `<link>` tags

---

## 10. MIGRACION DESDE GOOGLE SHEETS

### 10.1 Exportar datos de Google Sheets

1. Abrir cada hoja del Google Sheet
2. File → Download → CSV
3. Guardar en carpeta `data/`:
   - `Salas.csv`, `Bloques.csv`, `Usuarios.csv`, `Equipos.csv`
   - `Reservas.csv`, `ReservaEquipos.csv` (si aplica)

### 10.2 Ejecutar migracion

```bash
cd scripts
npm install

# Linux/Mac:
export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"

# Windows PowerShell:
$env:AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;..."

node migrate-to-azure.js
```

El script:
1. Crea las tablas si no existen
2. Parsea cada CSV
3. Transforma a entidades Table Storage con PartitionKey/RowKey correctos
4. Sube todo via upsert (idempotente, se puede re-ejecutar)

### 10.3 Diferencias Google Sheets vs Azure

| Aspecto | Google Sheets | Azure |
|---------|--------------|-------|
| Auth | Email + password manual | Microsoft Entra ID (SSO) |
| DB | Hojas de calculo | Table Storage (NoSQL) |
| Backend | Apps Script (GAS) | Azure Functions (Node.js) |
| Hosting | Apps Script URL | Azure Static Web Apps |
| Latencia | 1-3s por request | 50-200ms por request |
| Costo | Gratis | Free tier disponible |
| Limites | 6min timeout, 30 req/s | Mucho mas escalable |

---

## 11. VARIABLES DE ENTORNO NECESARIAS

### En Azure Static Web App → Configuration → Application Settings:

| Variable | Valor | Donde obtenerlo |
|----------|-------|-----------------|
| `AAD_CLIENT_ID` | GUID del App Registration | Entra ID → App Registrations → tu app → Application (client) ID |
| `AAD_CLIENT_SECRET` | Secret string | Entra ID → App Registrations → tu app → Certificates & Secrets |
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string completo | Storage Account → Access Keys |

### En GitHub → Repository Settings → Secrets:

| Secret | Valor | Donde obtenerlo |
|--------|-------|-----------------|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Token de deploy | Se genera automaticamente al crear el SWA |

---

## 12. CHECKLIST PARA REPLICAR EN PROYECTO NUEVO

```
[ ] 1. Crear repositorio GitHub
[ ] 2. Crear Storage Account en Azure
[ ] 3. Crear Static Web App en Azure (conectar al repo GitHub)
[ ] 4. Crear App Registration en Entra ID
[ ] 5. Configurar redirect URI: https://tu-app.azurestaticapps.net/.auth/login/aad/callback
[ ] 6. Agregar variables de entorno en SWA (AAD_CLIENT_ID, AAD_CLIENT_SECRET, AZURE_STORAGE_CONNECTION_STRING)
[ ] 7. Crear staticwebapp.config.json con tenant ID correcto
[ ] 8. Crear estructura api/ con host.json, package.json, shared/, functions/
[ ] 9. Crear frontend (index.html, js/, css/)
[ ] 10. Exportar datos del proyecto Google como CSV
[ ] 11. Adaptar y ejecutar script de migracion
[ ] 12. Push a master → deploy automatico
[ ] 13. Verificar auth flow: login → /.auth/me → getUserProfile
[ ] 14. Verificar CRUD completo
```

---

## 13. GOTCHAS Y LECCIONES APRENDIDAS

1. **authLevel siempre 'anonymous' en functions**: SWA maneja la auth a nivel de ruta, no la funcion. Si pones `authLevel: 'function'`, necesitas function keys que SWA no gestiona bien.

2. **Cache del navegador**: Usar `?v=N` en todos los `<script>` y `<link>`. Incrementar N en cada deploy importante.

3. **Table Storage no tiene autoincrement**: Generar IDs con `Date.now() * 1000 + random`. El RowKey SIEMPRE es string.

4. **PartitionKey es la clave de rendimiento**: Disenar las PK segun el patron de consulta principal. Nunca hacer scan de tabla completa en produccion.

5. **Batch operations**: Max 100 entidades, TODAS deben tener el mismo PartitionKey. Agrupar antes de enviar.

6. **x-ms-client-principal**: SWA inyecta este header solo en requests a `/api/*`. Es base64-encoded JSON. Nunca confiar en headers del frontend directamente.

7. **CORS no necesario**: SWA sirve frontend y API desde el mismo dominio, no hay CORS issues.

8. **Datos de config se cargan una vez**: `fullInit` se llama al iniciar la app. Los datos de salas/bloques/equipos se guardan en memoria (Calendar.salas, etc.) y se reutilizan sin re-fetch.

9. **Free tier de SWA**: Incluye Azure Functions integradas, custom domain, SSL, auth built-in. Limite: 2 custom domains, 0.5GB storage, 100GB bandwidth/mes.

10. **local.settings.json para desarrollo local**: Agregar al `.gitignore`. Contiene `AZURE_STORAGE_CONNECTION_STRING` para testing local con `swa start` o `func start`.
