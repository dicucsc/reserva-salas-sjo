/**
 * Migration Script: Google Sheets CSV → Azure Table Storage
 *
 * Usage:
 *   1. Export each Google Sheet tab as CSV into ./data/:
 *      - Salas.csv, Bloques.csv, Usuarios.csv, Equipos.csv, Reservas.csv, ReservaEquipos.csv
 *   2. Set environment variable: AZURE_STORAGE_CONNECTION_STRING
 *   3. Run: node scripts/migrate-to-azure.js
 *
 * CSV format assumptions:
 *   - First row is headers
 *   - Columns match the Google Sheets schema
 */

const fs = require('fs');
const path = require('path');
const { TableClient, TableServiceClient } = require('@azure/data-tables');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connectionString) {
  console.error('ERROR: Set AZURE_STORAGE_CONNECTION_STRING environment variable');
  process.exit(1);
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); });
    return obj;
  }).filter(obj => obj[headers[0].trim()]);
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        result.push(current);
        current = '';
      } else {
        current += c;
      }
    }
  }
  result.push(current);
  return result;
}

async function ensureTable(tableName) {
  const serviceClient = TableServiceClient.fromConnectionString(connectionString);
  try {
    await serviceClient.createTable(tableName);
    console.log(`  Table "${tableName}" created.`);
  } catch (e) {
    if (e.statusCode === 409) {
      console.log(`  Table "${tableName}" already exists.`);
    } else {
      throw e;
    }
  }
}

async function uploadEntities(tableName, entities) {
  const client = TableClient.fromConnectionString(connectionString, tableName);
  let count = 0;
  for (const entity of entities) {
    await client.upsertEntity(entity, 'Replace');
    count++;
  }
  console.log(`  Uploaded ${count} entities to "${tableName}".`);
}

function readCSV(filename) {
  const filePath = path.join(__dirname, '..', 'data', filename);
  if (!fs.existsSync(filePath)) {
    // Try ejemplo-sheets folder
    const altPath = path.join(__dirname, '..', 'ejemplo-sheets', filename);
    if (!fs.existsSync(altPath)) {
      console.log(`  WARNING: ${filename} not found, skipping.`);
      return [];
    }
    return parseCSV(fs.readFileSync(altPath, 'utf-8'));
  }
  return parseCSV(fs.readFileSync(filePath, 'utf-8'));
}

async function migrateSalas() {
  console.log('\n--- Salas ---');
  await ensureTable('Salas');
  const rows = readCSV('Salas.csv');
  const entities = rows.map(r => ({
    partitionKey: 'salas',
    rowKey: String(r.ID),
    Nombre: r.Nombre,
    Capacidad: Number(r.Capacidad) || 0
  }));
  await uploadEntities('Salas', entities);
}

async function migrateBloques() {
  console.log('\n--- Bloques ---');
  await ensureTable('Bloques');
  const rows = readCSV('Bloques.csv');
  const entities = rows.map(r => ({
    partitionKey: 'bloques',
    rowKey: String(r.ID),
    HoraInicio: r.HoraInicio || '',
    HoraFin: r.HoraFin || '',
    Etiqueta: r.Etiqueta || `${r.HoraInicio} - ${r.HoraFin}`
  }));
  await uploadEntities('Bloques', entities);
}

async function migrateUsuarios() {
  console.log('\n--- Usuarios ---');
  await ensureTable('Usuarios');
  const rows = readCSV('Usuarios.csv');
  const entities = rows.map(r => ({
    partitionKey: 'usuarios',
    rowKey: (r.Email || '').trim().toLowerCase(),
    Nombre: r.Nombre || '',
    Rol: r.Rol || 'user'
    // Password is NOT migrated — Entra ID handles auth
  }));
  await uploadEntities('Usuarios', entities);
}

async function migrateEquipos() {
  console.log('\n--- Equipos ---');
  await ensureTable('Equipos');
  const rows = readCSV('Equipos.csv');
  const entities = rows.map(r => ({
    partitionKey: 'equipos',
    rowKey: String(r.ID),
    Nombre: r.Nombre || '',
    Descripcion: r.Descripcion || '',
    Cantidad: Number(r.Cantidad) || 0
  }));
  await uploadEntities('Equipos', entities);
}

async function migrateReservas() {
  console.log('\n--- Reservas ---');
  await ensureTable('Reservas');
  const rows = readCSV('Reservas.csv');
  const entities = rows.map(r => {
    const fecha = String(r.Fecha || '').substring(0, 10);
    const month = fecha.substring(0, 7); // YYYY-MM
    return {
      partitionKey: month,
      rowKey: String(r.ID),
      SalaID: Number(r.SalaID) || 0,
      Fecha: fecha,
      BloqueID: Number(r.BloqueID) || 0,
      Email: (r.Email || '').trim().toLowerCase(),
      Nombre: r.Nombre || '',
      Actividad: r.Actividad || '',
      Recurrencia: r.Recurrencia || '',
      CreatedAt: r.CreatedAt || new Date().toISOString(),
      Comentarios: r.Comentarios || '',
      Equipos: r.Equipos || '',
      Responsable: r.Responsable || r.Nombre || ''
    };
  });
  await uploadEntities('Reservas', entities);
}

async function migrateReservaEquipos() {
  console.log('\n--- ReservaEquipos ---');
  await ensureTable('ReservaEquipos');
  const rows = readCSV('ReservaEquipos.csv');
  if (rows.length === 0) return;

  const entities = rows.map((r, idx) => {
    const fecha = String(r.Fecha || '').substring(0, 10);
    const month = fecha.substring(0, 7);
    const rowKey = r.ReservaID && r.EquipoID
      ? `${r.ReservaID}_${r.EquipoID}`
      : String(idx + 1);
    return {
      partitionKey: month,
      rowKey,
      ReservaID: String(r.ReservaID || ''),
      EquipoID: Number(r.EquipoID) || 0,
      NombreEquipo: r.NombreEquipo || '',
      Fecha: fecha,
      BloqueID: Number(r.BloqueID) || 0,
      SalaID: Number(r.SalaID) || 0,
      NombreSala: r.NombreSala || '',
      Responsable: r.Responsable || ''
    };
  });
  await uploadEntities('ReservaEquipos', entities);
}

async function main() {
  console.log('=== Migración Google Sheets → Azure Table Storage ===');
  console.log(`Connection: ${connectionString.substring(0, 40)}...`);

  await migrateSalas();
  await migrateBloques();
  await migrateUsuarios();
  await migrateEquipos();
  await migrateReservas();
  await migrateReservaEquipos();

  console.log('\n=== Migración completada ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
