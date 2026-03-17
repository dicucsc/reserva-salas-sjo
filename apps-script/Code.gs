/* ============================================================
   Sistema de Reserva de Salas – SJO
   Google Apps Script Backend
   Salas: Auditorio, Taller 1, Taller 2, Taller 3
   ============================================================ */

const SHEET_SALAS = 'Salas';
const SHEET_BLOQUES = 'Bloques';
const SHEET_RESERVAS = 'Reservas';
const SHEET_USUARIOS = 'Usuarios';

// ── Helpers ──────────────────────────────────────────────────

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).filter(row => row[0] !== '').map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatDate(d) {
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  return String(d).substring(0, 10);
}

function processBlocks(blocks) {
  const tz = Session.getScriptTimeZone();
  return blocks.map(b => {
    const start = b.HoraInicio instanceof Date
      ? Utilities.formatDate(b.HoraInicio, tz, 'HH:mm')
      : String(b.HoraInicio);
    const end = b.HoraFin instanceof Date
      ? Utilities.formatDate(b.HoraFin, tz, 'HH:mm')
      : String(b.HoraFin);
    return {
      ...b,
      HoraInicio: start,
      HoraFin: end,
      Etiqueta: b.Etiqueta || (start + ' - ' + end)
    };
  });
}

// ── Cache ───────────────────────────────────────────────────

function getCached(key, ttlSeconds, fetchFn) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key);
  if (raw !== null) return JSON.parse(raw);
  const data = fetchFn();
  const json = JSON.stringify(data);
  if (json.length < 100000) cache.put(key, json, ttlSeconds);
  return data;
}

function invalidateCache() {
  const cache = CacheService.getScriptCache();
  const now = new Date();
  const year = now.getFullYear();
  const keys = ['data_salas', 'data_bloques', 'data_usuarios',
                'year_compact_' + year, 'year_compact_' + (year + 1)];
  cache.removeAll(keys);
}

// ── Validación de usuario ───────────────────────────────────

function validateUser(email) {
  if (!email) return null;
  const users = getCached('data_usuarios', 300, () => sheetToObjects(getSheet(SHEET_USUARIOS)));
  const normalized = email.trim().toLowerCase();
  return users.find(u => String(u.Email).trim().toLowerCase() === normalized) || null;
}

// ── Year Compact ────────────────────────────────────────────

function getYearCompact(year) {
  const yearNum = Number(year);
  const cacheKey = 'year_compact_' + yearNum;
  return getCached(cacheKey, 60, () => buildYearCompact(yearNum));
}

function buildYearCompact(year) {
  const sheet = getSheet(SHEET_RESERVAS);
  const all = sheetToObjects(sheet);

  const firstStr = year + '-01-01';
  const lastStr = year + '-12-31';

  const yearReservations = all.filter(r => {
    const f = formatDate(r.Fecha);
    return f >= firstStr && f <= lastStr;
  });

  // Build lookup tables
  const userMap = new Map();
  const actMap = new Map();
  const groupMap = new Map();
  const users = [];
  const activities = [];
  const groups = [];

  yearReservations.forEach(r => {
    const email = String(r.Email || '').trim().toLowerCase();
    const nombre = String(r.Nombre || '');
    const userKey = email;
    if (!userMap.has(userKey)) {
      userMap.set(userKey, users.length);
      users.push([email, nombre]);
    }

    const act = String(r.Actividad || '');
    if (!actMap.has(act)) {
      actMap.set(act, activities.length);
      activities.push(act);
    }

    const rec = String(r.Recurrencia || '');
    if (rec && !groupMap.has(rec)) {
      groupMap.set(rec, groups.length);
      groups.push(rec);
    }
  });

  // Build compact records
  const records = yearReservations.map(r => {
    const fecha = r.Fecha instanceof Date ? r.Fecha : new Date(formatDate(r.Fecha) + 'T00:00:00');
    const startOfYear = new Date(year, 0, 1);
    const doy = Math.floor((fecha - startOfYear) / 86400000) + 1;

    const email = String(r.Email || '').trim().toLowerCase();
    const act = String(r.Actividad || '');
    const rec = String(r.Recurrencia || '');

    return [
      Number(r.ID),
      Number(r.SalaID),
      doy,
      Number(r.BloqueID),
      userMap.get(email),
      actMap.get(act),
      rec ? groupMap.get(rec) : -1
    ];
  });

  return {
    y: year,
    u: users,
    a: activities,
    g: groups,
    r: records
  };
}

// ── Web App Entry Points ────────────────────────────────────

function doGet(e) {
  const action = e.parameter.action;

  try {
    switch (action) {
      case 'fullInit': {
        const salas = getCached('data_salas', 600, () => sheetToObjects(getSheet(SHEET_SALAS)));
        const bloques = getCached('data_bloques', 600, () => processBlocks(sheetToObjects(getSheet(SHEET_BLOQUES))));
        return jsonResponse({ ok: true, data: { salas, bloques } });
      }

      case 'login': {
        const email = e.parameter.email;
        if (!email) return jsonResponse({ ok: false, error: 'Falta el email' });
        const user = validateUser(email);
        if (!user) return jsonResponse({ ok: false, error: 'Usuario no registrado. Contacta al administrador.' });
        return jsonResponse({ ok: true, data: user });
      }

      case 'getYearCompact': {
        const year = e.parameter.year;
        if (!year) return jsonResponse({ ok: false, error: 'Falta parámetro year' });
        return jsonResponse({ ok: true, data: getYearCompact(year) });
      }

      default:
        return jsonResponse({ ok: false, error: 'Acción no válida: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case 'createReservation':
        return jsonResponse(createReservation(body));
      case 'cancelReservation':
        return jsonResponse(cancelReservation(body));
      case 'cancelRecurrenceGroup':
        return jsonResponse(cancelRecurrenceGroup(body));
      default:
        return jsonResponse({ ok: false, error: 'Acción POST no válida: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Crear reserva ───────────────────────────────────────────

function createReservation(body) {
  const { slots, email, actividad, recurrenciaGrupo } = body;

  if (!slots || !slots.length || !email)
    return { ok: false, error: 'Faltan campos obligatorios' };

  const user = validateUser(email);
  if (!user)
    return { ok: false, error: 'Usuario no registrado' };

  const nombreReal = user.Nombre;

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return { ok: false, error: 'Sistema ocupado, intenta de nuevo' };
  }

  let result;
  let emailData = null;

  try {
    const resSheet = getSheet(SHEET_RESERVAS);
    const existentes = sheetToObjects(resSheet);

    // Cache salas/bloques once
    const salas = getCached('data_salas', 600, () => sheetToObjects(getSheet(SHEET_SALAS)));
    const bloques = getCached('data_bloques', 600, () => processBlocks(sheetToObjects(getSheet(SHEET_BLOQUES))));

    // Verificar que ningún slot esté ocupado
    for (const s of slots) {
      const ocupado = existentes.some(r =>
        String(r.SalaID) === String(s.salaId) &&
        formatDate(r.Fecha) === s.fecha &&
        String(r.BloqueID) === String(s.bloqueId)
      );
      if (ocupado) {
        const bloque = bloques.find(b => String(b.ID) === String(s.bloqueId));
        return { ok: false, error: 'Ya reservado: ' + s.fecha + ' ' + (bloque ? bloque.Etiqueta : 'Bloque ' + s.bloqueId) };
      }
    }

    let maxId = existentes.length > 0
      ? Math.max(...existentes.map(r => Number(r.ID)))
      : 0;

    const createdIds = [];
    const now = new Date().toISOString();
    const rows = [];

    for (const s of slots) {
      maxId++;
      rows.push([maxId, Number(s.salaId), s.fecha, Number(s.bloqueId), email, nombreReal, actividad || '', recurrenciaGrupo || '', now]);
      createdIds.push(maxId);
    }

    // Batch write
    const lastRow = resSheet.getLastRow();
    resSheet.getRange(lastRow + 1, 1, rows.length, 9).setValues(rows);

    emailData = buildEmailData(slots, salas, bloques, actividad);
    result = { ok: true, data: { ids: createdIds, count: createdIds.length } };
  } finally {
    lock.releaseLock();
  }

  // Email fuera del lock
  if (emailData) {
    try { sendConfirmationEmail(email, nombreReal, emailData); } catch(e) {}
  }

  return result;
}

function buildEmailData(slots, salas, bloques, actividad) {
  return {
    slots: slots.map(s => {
      const sala = salas.find(l => String(l.ID) === String(s.salaId));
      const bloque = bloques.find(b => String(b.ID) === String(s.bloqueId));
      return {
        sala: sala ? sala.Nombre : 'Sala ' + s.salaId,
        fecha: s.fecha,
        bloque: bloque ? bloque.Etiqueta : 'Bloque ' + s.bloqueId
      };
    }),
    actividad
  };
}

// ── Cancelar reserva ────────────────────────────────────────

function cancelReservation(body) {
  const { reservaId, email } = body;

  if (!reservaId || !email)
    return { ok: false, error: 'Faltan reservaId y email' };

  const user = validateUser(email);
  if (!user)
    return { ok: false, error: 'Usuario no registrado' };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return { ok: false, error: 'Sistema ocupado, intenta de nuevo' };
  }

  let result;
  let emailData = null;

  try {
    const resSheet = getSheet(SHEET_RESERVAS);
    const data = resSheet.getDataRange().getValues();

    let rowToDelete = -1;
    let reservaRow = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(reservaId) &&
          String(data[i][4]).trim().toLowerCase() === email.trim().toLowerCase()) {
        rowToDelete = i + 1;
        reservaRow = data[i];
        break;
      }
    }

    if (rowToDelete === -1)
      return { ok: false, error: 'Reserva no encontrada o email no coincide' };

    const salas = getCached('data_salas', 600, () => sheetToObjects(getSheet(SHEET_SALAS)));
    const bloques = getCached('data_bloques', 600, () => processBlocks(sheetToObjects(getSheet(SHEET_BLOQUES))));
    const salaInfo = salas.find(l => String(l.ID) === String(reservaRow[1]));
    const bloqueInfo = bloques.find(b => String(b.ID) === String(reservaRow[3]));

    emailData = {
      sala: salaInfo ? salaInfo.Nombre : 'Sala ' + reservaRow[1],
      fecha: formatDate(reservaRow[2]),
      bloque: bloqueInfo ? bloqueInfo.Etiqueta : 'Bloque ' + reservaRow[3],
      actividad: reservaRow[6] || ''
    };

    resSheet.deleteRow(rowToDelete);
    result = { ok: true };
  } finally {
    lock.releaseLock();
  }

  if (emailData) {
    try { sendCancellationEmail(email, user.Nombre, emailData); } catch(e) {}
  }

  return result;
}

// ── Cancelar grupo de recurrencia ───────────────────────────

function cancelRecurrenceGroup(body) {
  const { recurrenciaGrupo, email } = body;

  if (!recurrenciaGrupo || !email)
    return { ok: false, error: 'Faltan parámetros' };

  const user = validateUser(email);
  if (!user)
    return { ok: false, error: 'Usuario no registrado' };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return { ok: false, error: 'Sistema ocupado' };
  }

  try {
    const resSheet = getSheet(SHEET_RESERVAS);
    const data = resSheet.getDataRange().getValues();
    let count = 0;

    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][7]) === recurrenciaGrupo &&
          String(data[i][4]).trim().toLowerCase() === email.trim().toLowerCase()) {
        resSheet.deleteRow(i + 1);
        count++;
      }
    }

    if (count > 0) {
      return { ok: true, data: { canceladas: count } };
    }
    return { ok: false, error: 'No se encontraron reservas del grupo' };
  } finally {
    lock.releaseLock();
  }
}

// ── Emails ──────────────────────────────────────────────────

function buildEmailHtml(title, color, nombre, tableRows) {
  const cellStyle = 'padding:6px 10px;border:1px solid #dee2e6';
  return '<div style="font-family:Arial,sans-serif;max-width:600px">' +
    '<h2 style="color:' + color + '">' + title + '</h2>' +
    '<p>Hola <strong>' + nombre + '</strong>,</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
    tableRows.map(r =>
      '<tr>' + r.map(c => '<td style="' + cellStyle + '">' + c + '</td>').join('') + '</tr>'
    ).join('') +
    '</table>' +
    '<hr><p style="color:#6c757d;font-size:12px">Sistema de Reserva de Salas – SJO</p></div>';
}

function sendConfirmationEmail(email, nombre, data) {
  const headerRow = ['<strong>Sala</strong>', '<strong>Fecha</strong>', '<strong>Bloque</strong>'];
  const rows = [headerRow];
  data.slots.forEach(s => rows.push([s.sala, s.fecha, s.bloque]));

  const actLine = '<p><strong>Actividad:</strong> ' + (data.actividad || '-') + '</p>';
  const tableHtml = buildEmailHtml('Reserva Confirmada', '#059669', nombre, rows);
  const html = tableHtml.replace('</table>', '</table>' + actLine);

  MailApp.sendEmail({
    to: email,
    subject: 'Reserva confirmada – Salas SJO (' + data.slots.length + ' bloque' + (data.slots.length > 1 ? 's' : '') + ')',
    htmlBody: html
  });
}

function sendCancellationEmail(email, nombre, data) {
  const rows = [
    ['<strong>Sala</strong>', data.sala],
    ['<strong>Fecha</strong>', data.fecha],
    ['<strong>Bloque</strong>', data.bloque],
    ['<strong>Actividad</strong>', data.actividad]
  ];

  const html = buildEmailHtml('Reserva Cancelada', '#dc2626', nombre, rows);

  MailApp.sendEmail({
    to: email,
    subject: 'Reserva cancelada – ' + data.sala + ' – ' + data.fecha,
    htmlBody: html
  });
}
