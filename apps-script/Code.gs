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
  cache.removeAll(['data_salas', 'data_bloques', 'data_usuarios']);
}

// ── Validación de usuario ───────────────────────────────────

function validateUser(email) {
  if (!email) return null;
  const users = getCached('data_usuarios', 300, () => sheetToObjects(getSheet(SHEET_USUARIOS)));
  const normalized = email.trim().toLowerCase();
  return users.find(u => String(u.Email).trim().toLowerCase() === normalized) || null;
}

// ── Lecturas de reservas ────────────────────────────────────

function getReservationsForMonth(fechaStr) {
  const base = new Date(fechaStr + 'T00:00:00');
  const firstStr = formatDate(new Date(base.getFullYear(), base.getMonth(), 1));
  const lastStr = formatDate(new Date(base.getFullYear(), base.getMonth() + 1, 0));

  const sheet = getSheet(SHEET_RESERVAS);
  const all = sheetToObjects(sheet);
  return all.filter(r => {
    const f = formatDate(r.Fecha);
    return f >= firstStr && f <= lastStr;
  }).map(r => ({
    ...r,
    Fecha: formatDate(r.Fecha),
    FechaCreacion: r.FechaCreacion ? formatDate(r.FechaCreacion) : ''
  }));
}

function getReservationsForDate(fecha) {
  const sheet = getSheet(SHEET_RESERVAS);
  const all = sheetToObjects(sheet);
  return all.filter(r => formatDate(r.Fecha) === fecha).map(r => ({
    ...r,
    Fecha: formatDate(r.Fecha)
  }));
}

function getReservationsForWeek(fechaStr) {
  const base = new Date(fechaStr + 'T00:00:00');
  const day = base.getDay();
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((day + 6) % 7));
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(formatDate(d));
  }
  const sheet = getSheet(SHEET_RESERVAS);
  const all = sheetToObjects(sheet);
  return all.filter(r => dates.includes(formatDate(r.Fecha))).map(r => ({
    ...r,
    Fecha: formatDate(r.Fecha)
  }));
}

// ── Web App Entry Points ────────────────────────────────────

function doGet(e) {
  const action = e.parameter.action;

  try {
    switch (action) {
      case 'fullInit': {
        const fecha = e.parameter.fecha;
        const salas = getCached('data_salas', 600, () => sheetToObjects(getSheet(SHEET_SALAS)));
        const bloques = getCached('data_bloques', 600, () => processBlocks(sheetToObjects(getSheet(SHEET_BLOQUES))));
        const reservas = fecha ? getReservationsForMonth(fecha) : [];
        return jsonResponse({ ok: true, data: { salas, bloques, reservas } });
      }

      case 'login': {
        const email = e.parameter.email;
        if (!email) return jsonResponse({ ok: false, error: 'Falta el email' });
        const user = validateUser(email);
        if (!user) return jsonResponse({ ok: false, error: 'Usuario no registrado. Contacta al administrador.' });
        return jsonResponse({ ok: true, data: user });
      }

      case 'getReservations': {
        const fecha = e.parameter.fecha;
        if (!fecha) return jsonResponse({ ok: false, error: 'Falta parámetro fecha' });
        return jsonResponse({ ok: true, data: getReservationsForDate(fecha) });
      }

      case 'getWeek': {
        const fecha = e.parameter.fecha;
        if (!fecha) return jsonResponse({ ok: false, error: 'Falta parámetro fecha' });
        return jsonResponse({ ok: true, data: getReservationsForWeek(fecha) });
      }

      case 'getMonth': {
        const fecha = e.parameter.fecha;
        if (!fecha) return jsonResponse({ ok: false, error: 'Falta parámetro fecha' });
        return jsonResponse({ ok: true, data: getReservationsForMonth(fecha) });
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
  // slots = [{ salaId, fecha, bloqueId }, ...]

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

    // Verificar que ningún slot esté ocupado
    for (const s of slots) {
      const ocupado = existentes.some(r =>
        String(r.SalaID) === String(s.salaId) &&
        formatDate(r.Fecha) === s.fecha &&
        String(r.BloqueID) === String(s.bloqueId)
      );
      if (ocupado) {
        const bloques = getCached('data_bloques', 600, () => processBlocks(sheetToObjects(getSheet(SHEET_BLOQUES))));
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

    // Datos para email
    const salas = getCached('data_salas', 600, () => sheetToObjects(getSheet(SHEET_SALAS)));
    const bloques = getCached('data_bloques', 600, () => processBlocks(sheetToObjects(getSheet(SHEET_BLOQUES))));

    emailData = {
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

function sendConfirmationEmail(email, nombre, data) {
  const slotsHtml = data.slots.map(s =>
    '<tr><td style="padding:6px 10px;border:1px solid #dee2e6">' + s.sala + '</td>' +
    '<td style="padding:6px 10px;border:1px solid #dee2e6">' + s.fecha + '</td>' +
    '<td style="padding:6px 10px;border:1px solid #dee2e6">' + s.bloque + '</td></tr>'
  ).join('');

  const html = '<div style="font-family:Arial,sans-serif;max-width:600px">' +
    '<h2 style="color:#059669">Reserva Confirmada</h2>' +
    '<p>Hola <strong>' + nombre + '</strong>,</p>' +
    '<p>Tu reserva ha sido registrada:</p>' +
    '<p><strong>Actividad:</strong> ' + (data.actividad || '-') + '</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr style="background:#f8fafc"><th style="padding:6px 10px;border:1px solid #dee2e6;text-align:left">Sala</th>' +
    '<th style="padding:6px 10px;border:1px solid #dee2e6;text-align:left">Fecha</th>' +
    '<th style="padding:6px 10px;border:1px solid #dee2e6;text-align:left">Bloque</th></tr>' +
    slotsHtml +
    '</table>' +
    '<hr><p style="color:#6c757d;font-size:12px">Sistema de Reserva de Salas – SJO</p></div>';

  MailApp.sendEmail({
    to: email,
    subject: 'Reserva confirmada – Salas SJO (' + data.slots.length + ' bloque' + (data.slots.length > 1 ? 's' : '') + ')',
    htmlBody: html
  });
}

function sendCancellationEmail(email, nombre, data) {
  const html = '<div style="font-family:Arial,sans-serif;max-width:600px">' +
    '<h2 style="color:#dc2626">Reserva Cancelada</h2>' +
    '<p>Hola <strong>' + nombre + '</strong>,</p>' +
    '<p>Tu reserva ha sido cancelada:</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr><td style="padding:6px 10px;border:1px solid #dee2e6"><strong>Sala</strong></td>' +
        '<td style="padding:6px 10px;border:1px solid #dee2e6">' + data.sala + '</td></tr>' +
    '<tr><td style="padding:6px 10px;border:1px solid #dee2e6"><strong>Fecha</strong></td>' +
        '<td style="padding:6px 10px;border:1px solid #dee2e6">' + data.fecha + '</td></tr>' +
    '<tr><td style="padding:6px 10px;border:1px solid #dee2e6"><strong>Bloque</strong></td>' +
        '<td style="padding:6px 10px;border:1px solid #dee2e6">' + data.bloque + '</td></tr>' +
    '<tr><td style="padding:6px 10px;border:1px solid #dee2e6"><strong>Actividad</strong></td>' +
        '<td style="padding:6px 10px;border:1px solid #dee2e6">' + data.actividad + '</td></tr>' +
    '</table>' +
    '<hr><p style="color:#6c757d;font-size:12px">Sistema de Reserva de Salas – SJO</p></div>';

  MailApp.sendEmail({
    to: email,
    subject: 'Reserva cancelada – ' + data.sala + ' – ' + data.fecha,
    htmlBody: html
  });
}
