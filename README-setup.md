# Configuración del Sistema de Reserva de Salas – SJO

## Paso 1: Crear el Google Sheet

1. Ve a [Google Sheets](https://sheets.google.com) y crea una hoja nueva
2. Crea **4 hojas** (pestañas) con estos nombres exactos:

### Hoja "Salas"
| ID | Nombre | Capacidad | Ubicacion |
|----|--------|-----------|-----------|
| 1 | Auditorio | 100 | Edificio Principal |
| 2 | Taller 1 | 30 | Edificio Principal |
| 3 | Taller 2 | 30 | Edificio Principal |
| 4 | Taller 3 | 30 | Edificio Principal |

### Hoja "Bloques"
| ID | HoraInicio | HoraFin | Etiqueta |
|----|------------|---------|----------|
| 1 | 08:00 | 10:00 | Bloque 1 (08:00-10:00) |
| 2 | 10:00 | 12:00 | Bloque 2 (10:00-12:00) |
| 3 | 12:00 | 14:00 | Bloque 3 (12:00-14:00) |
| 4 | 14:00 | 16:00 | Bloque 4 (14:00-16:00) |
| 5 | 16:00 | 18:00 | Bloque 5 (16:00-18:00) |

### Hoja "Reservas"
Solo crear los encabezados (se llena automáticamente):
| ID | SalaID | Fecha | BloqueID | Email | Nombre | Actividad | Recurrencia | FechaCreacion |
|----|--------|-------|----------|-------|--------|-----------|-------------|---------------|

### Hoja "Usuarios"
| Email | Nombre | Rol |
|-------|--------|-----|
| admin@institucion.edu | Administrador | admin |
| juan@institucion.edu | Juan Pérez | profesor |

## Paso 2: Configurar Google Apps Script

1. En el Google Sheet, ve a **Extensiones → Apps Script**
2. Borra el contenido por defecto
3. Copia y pega todo el contenido de `apps-script/Code.gs`
4. Guarda el proyecto (Ctrl+S)

## Paso 3: Desplegar como Web App

1. En Apps Script, click en **Implementar → Nueva implementación**
2. En tipo, selecciona **App web**
3. Configura:
   - **Ejecutar como**: Tu cuenta
   - **Quién tiene acceso**: **Cualquier persona**
4. Click en **Implementar**
5. Autoriza los permisos cuando se solicite
6. **Copia la URL** de la Web App

## Paso 4: Configurar el Frontend

1. Abre el archivo `js/api.js`
2. Reemplaza `TU_DEPLOYMENT_ID` en la variable `API_URL` con la URL copiada:
   ```javascript
   const API_URL = 'https://script.google.com/macros/s/TU_URL_REAL/exec';
   ```

## Paso 5: Usar la aplicación

- **Local**: Abre `index.html` directamente en el navegador
- **Hosting**: Sube todos los archivos a cualquier hosting estático (GitHub Pages, Netlify, etc.)

## Funcionalidades

- **Reserva por bloque**: Selecciona una o varias celdas libres en el calendario y reserva
- **Reserva recurrente**: Al reservar, marca "Repetir semanalmente" y elige una fecha límite (ej: todos los martes de 10-12 por 3 semanas)
- **Cancelación**: Click en tus reservas (doradas) para seleccionar y cancelar
- **Cancelación en grupo**: Las reservas recurrentes se pueden cancelar como grupo desde "Mis Reservas"
- **Vistas**: Día, Semana, Mes con indicadores de ocupación

## Notas

- Cada vez que modifiques `Code.gs`, crea una **nueva implementación** en Apps Script
- Los datos de salas y bloques se gestionan directamente en el Google Sheet
- Las reservas se escriben automáticamente
- Se envían emails de confirmación/cancelación automáticamente
