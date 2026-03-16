# Configuración del Sistema de Reserva de Laboratorios

## Paso 1: Crear el Google Sheet

1. Ve a [Google Sheets](https://sheets.google.com) y crea una hoja nueva
2. Crea **5 hojas** (pestañas) con estos nombres exactos:

### Hoja "Laboratorios"
| ID | Nombre | Capacidad | Ubicacion |
|----|--------|-----------|-----------|
| 1 | Laboratorio de Física | 30 | Edificio A, Piso 2 |
| 2 | Laboratorio de Química | 25 | Edificio A, Piso 3 |
| 3 | Laboratorio de Informática | 40 | Edificio B, Piso 1 |

### Hoja "Bloques"
| ID | HoraInicio | HoraFin | Etiqueta |
|----|------------|---------|----------|
| 1 | 08:00 | 10:00 | Bloque 1 (8:00-10:00) |
| 2 | 10:00 | 12:00 | Bloque 2 (10:00-12:00) |
| 3 | 12:00 | 14:00 | Bloque 3 (12:00-14:00) |
| 4 | 14:00 | 16:00 | Bloque 4 (14:00-16:00) |
| 5 | 16:00 | 18:00 | Bloque 5 (16:00-18:00) |

### Hoja "Equipos"
| ID | Nombre | Categoria | LabID | Cantidad | Descripcion |
|----|--------|-----------|-------|----------|-------------|
| 1 | Osciloscopio Tektronix | Electrónica | 1 | 5 | Osciloscopio digital 100MHz |
| 2 | Multímetro Fluke | Electrónica | | 10 | Multímetro digital de banco |
| 3 | Fuente de poder DC | Electrónica | 1 | 8 | Fuente regulable 0-30V |
| ... | ... | ... | ... | ... | ... |

- **LabID vacío** = equipo general disponible en cualquier laboratorio
- **LabID con valor** = equipo exclusivo de ese laboratorio
- **Categorías sugeridas**: Óptica, Electrónica, Medición, Química, Informática, Mecánica

### Hoja "Reservas"
Solo crear los encabezados (se llena automáticamente):
| ID | LabID | Fecha | BloqueID | Email | Nombre | Actividad | FechaCreacion |
|----|-------|-------|----------|-------|--------|-----------|---------------|

### Hoja "ReservaEquipos"
Solo crear los encabezados (se llena automáticamente):
| ReservaID | EquipoID | Cantidad |
|-----------|----------|----------|

## Paso 2: Configurar Google Apps Script

1. En el Google Sheet, ve a **Extensiones → Apps Script**
2. Borra el contenido por defecto
3. Copia y pega todo el contenido de `apps-script/Code.gs`
4. Guarda el proyecto (Ctrl+S)

## Paso 3: Desplegar como Web App

1. En Apps Script, click en **Implementar → Nueva implementación**
2. En tipo, selecciona **App web**
3. Configura:
   - **Descripción**: Reserva de Labs API
   - **Ejecutar como**: Tu cuenta
   - **Quién tiene acceso**: **Cualquier persona**
4. Click en **Implementar**
5. Autoriza los permisos cuando se solicite
6. **Copia la URL** de la Web App (algo como `https://script.google.com/macros/s/XXXX/exec`)

## Paso 4: Configurar el Frontend

1. Abre el archivo `js/api.js`
2. Reemplaza `TU_SCRIPT_ID_AQUI` en la variable `API_URL` con la URL copiada:
   ```javascript
   const API_URL = 'https://script.google.com/macros/s/TU_URL_REAL/exec';
   ```

## Paso 5: Usar la aplicación

- **Local**: Abre `index.html` directamente en el navegador
- **Hosting**: Sube todos los archivos a cualquier hosting estático (GitHub Pages, Netlify, etc.)

## Notas importantes

- Cada vez que modifiques `Code.gs`, debes crear una **nueva implementación** en Apps Script para que los cambios surtan efecto
- Los datos de laboratorios, bloques y equipos se gestionan directamente en el Google Sheet
- Las reservas y equipos reservados se escriben automáticamente en las hojas correspondientes
- No se requiere cuenta Google para los usuarios finales
