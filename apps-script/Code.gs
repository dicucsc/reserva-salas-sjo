// ============================================
// Google Apps Script - Sistema de Reserva de Laboratorios
// Copiar este código en: Extensiones → Apps Script
// Desplegar como Web App con acceso "Cualquiera"
// ============================================

const SHEET_LABS = 'Laboratorios';
const SHEET_BLOCKS = 'Bloques';
const SHEET_EQUIPMENT = 'Equipos';
const SHEET_RESERVATIONS = 'Reservas';
const SHEET_RES_EQUIPMENT = 'ReservaEquipos';
const SHEET_USERS = 'Usuarios';

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

// --- Cache helpers ---

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
  cache.removeAll(['data_labs', 'data_blocks', 'data_equipment', 'data_users', 'data_res_equip']);
}

// --- Validación de usuario ---

function validateUser(email) {
  if (!email) return null;
  const users = getCached('data_users', 300, () => sheetToObjects(getSheet(SHEET_USERS)));
  const normalized = email.trim().toLowerCase();
  return users.find(u => String(u.Email).trim().toLowerCase() === normalized) || null;
}

function doGet(e) {
  const action = e.parameter.action;

  try {
    switch (action) {
      case 'fullInit': {
        const fecha = e.parameter.fecha;
        const labs = getCached('data_labs', 600, () => sheetToObjects(getSheet(SHEET_LABS)));
        const blocks = getCached('data_blocks', 600, () => sheetToObjects(getSheet(SHEET_BLOCKS)));
        const equipment = getCached('data_equipment', 600, () => sheetToObjects(getSheet(SHEET_EQUIPMENT)));
        const reservations = fecha ? getReservationsForMonth(fecha) : [];
        return jsonResponse({ ok: true, data: { labs, blocks, equipment, reservations } });
      }

      case 'init': {
        const labs = getCached('data_labs', 600, () => sheetToObjects(getSheet(SHEET_LABS)));
        const blocks = getCached('data_blocks', 600, () => sheetToObjects(getSheet(SHEET_BLOCKS)));
        const equipment = getCached('data_equipment', 600, () => sheetToObjects(getSheet(SHEET_EQUIPMENT)));
        return jsonResponse({ ok: true, data: { labs, blocks, equipment } });
      }

      case 'login': {
        const email = e.parameter.email;
        if (!email) return jsonResponse({ ok: false, error: 'Falta el email' });
        const user = validateUser(email);
        if (!user) return jsonResponse({ ok: false, error: 'Usuario no registrado. Contacta al administrador.' });
        return jsonResponse({ ok: true, data: user });
      }

      case 'getLabs':
        return jsonResponse({ ok: true, data: getCached('data_labs', 600, () => sheetToObjects(getSheet(SHEET_LABS))) });

      case 'getBlocks':
        return jsonResponse({ ok: true, data: getCached('data_blocks', 600, () => sheetToObjects(getSheet(SHEET_BLOCKS))) });

      case 'getEquipment':
        return jsonResponse({ ok: true, data: getCached('data_equipment', 600, () => sheetToObjects(getSheet(SHEET_EQUIPMENT))) });

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

      case 'getAvailability': {
        const labId = e.parameter.labId;
        const fecha = e.parameter.fecha;
        const bloqueId = e.parameter.bloqueId;
        if (!labId || !fecha || !bloqueId)
          return jsonResponse({ ok: false, error: 'Faltan parámetros (labId, fecha, bloqueId)' });
        return jsonResponse({ ok: true, data: getEquipmentAvailability(labId, fecha, bloqueId) });
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
      default:
        return jsonResponse({ ok: false, error: 'Acción POST no válida: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// --- Utilidades de fecha ---

function formatDate(d) {
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  return String(d);
}

function enrichReservations(reservas) {
  const allEquip = getCached('data_res_equip', 30, () => sheetToObjects(getSheet(SHEET_RES_EQUIPMENT)));
  return reservas.map(r => ({
    ...r,
    Fecha: formatDate(r.Fecha),
    FechaCreacion: formatDate(r.FechaCreacion),
    equipos: allEquip.filter(eq => String(eq.ReservaID) === String(r.ID))
  }));
}

// --- Reservas por fecha ---

function getReservationsForDate(fecha) {
  const sheet = getSheet(SHEET_RESERVATIONS);
  const all = sheetToObjects(sheet);
  const reservas = all.filter(r => formatDate(r.Fecha) === fecha);
  return enrichReservations(reservas);
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

  const sheet = getSheet(SHEET_RESERVATIONS);
  const all = sheetToObjects(sheet);
  const reservas = all.filter(r => dates.includes(formatDate(r.Fecha)));
  return enrichReservations(reservas);
}

function getReservationsForMonth(fechaStr) {
  const base = new Date(fechaStr + 'T00:00:00');
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstStr = formatDate(firstDay);
  const lastStr = formatDate(lastDay);

  const sheet = getSheet(SHEET_RESERVATIONS);
  const all = sheetToObjects(sheet);
  const reservas = all.filter(r => {
    const f = formatDate(r.Fecha);
    return f >= firstStr && f <= lastStr;
  });
  return enrichReservations(reservas);
}

// --- Disponibilidad de equipos ---

function getEquipmentAvailability(labId, fecha, bloqueId) {
  const equipos = getCached('data_equipment', 600, () => sheetToObjects(getSheet(SHEET_EQUIPMENT)));
  const reservas = sheetToObjects(getSheet(SHEET_RESERVATIONS));
  const resEquipos = sheetToObjects(getSheet(SHEET_RES_EQUIPMENT));

  const relevantes = equipos.filter(eq =>
    String(eq.LabID) === '' || String(eq.LabID) === String(labId)
  );

  const resBloque = reservas.filter(r =>
    formatDate(r.Fecha) === fecha && String(r.BloqueID) === String(bloqueId)
  );
  const resIds = resBloque.map(r => String(r.ID));
  const equiposReservados = resEquipos.filter(re => resIds.includes(String(re.ReservaID)));

  return relevantes.map(eq => {
    const reservados = equiposReservados
      .filter(re => String(re.EquipoID) === String(eq.ID))
      .reduce((sum, re) => sum + Number(re.Cantidad), 0);
    return {
      ...eq,
      CantidadTotal: Number(eq.Cantidad),
      Reservados: reservados,
      Disponible: Number(eq.Cantidad) - reservados
    };
  });
}

// --- Email de confirmación ---

function sendConfirmationEmail(email, nombre, reservationData) {
  const { labName, fecha, bloques, actividad, equipos } = reservationData;
  const bloquesText = bloques.join(', ');
  const equiposHtml = equipos && equipos.length > 0
    ? '<ul>' + equipos.map(e => '<li>' + e.nombre + ' &times; ' + e.cantidad + '</li>').join('') + '</ul>'
    : '<p>Sin equipos seleccionados</p>';

  const html = '<div style="font-family:Arial,sans-serif;max-width:600px">' +
    '<h2 style="color:#0d6efd">Reserva Confirmada</h2>' +
    '<p>Hola <strong>' + nombre + '</strong>,</p>' +
    '<p>Tu reserva ha sido registrada exitosamente:</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
      '<tr><td style="padding:8px;border:1px solid #dee2e6"><strong>Laboratorio</strong></td>' +
          '<td style="padding:8px;border:1px solid #dee2e6">' + labName + '</td></tr>' +
      '<tr><td style="padding:8px;border:1px solid #dee2e6"><strong>Fecha</strong></td>' +
          '<td style="padding:8px;border:1px solid #dee2e6">' + fecha + '</td></tr>' +
      '<tr><td style="padding:8px;border:1px solid #dee2e6"><strong>Bloque(s)</strong></td>' +
          '<td style="padding:8px;border:1px solid #dee2e6">' + bloquesText + '</td></tr>' +
      '<tr><td style="padding:8px;border:1px solid #dee2e6"><strong>Actividad</strong></td>' +
          '<td style="padding:8px;border:1px solid #dee2e6">' + (actividad || '-') + '</td></tr>' +
    '</table>' +
    '<h3>Equipos:</h3>' +
    equiposHtml +
    '<hr>' +
    '<p style="color:#6c757d;font-size:12px">Sistema de Gesti&oacute;n de Labs de SJO</p>' +
    '</div>';

  MailApp.sendEmail({
    to: email,
    subject: 'Reserva confirmada — ' + labName + ' — ' + fecha,
    htmlBody: html
  });
}

function sendCancellationEmail(email, nombre, reservationData) {
  const { labName, fecha, bloques, actividad } = reservationData;
  const bloquesText = bloques.join(', ');

  const html = '<div style="font-family:Arial,sans-serif;max-width:600px">' +
    '<h2 style="color:#dc3545">Reserva Cancelada</h2>' +
    '<p>Hola <strong>' + nombre + '</strong>,</p>' +
    '<p>Tu reserva ha sido cancelada exitosamente:</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
      '<tr><td style="padding:8px;border:1px solid #dee2e6"><strong>Laboratorio</strong></td>' +
          '<td style="padding:8px;border:1px solid #dee2e6">' + labName + '</td></tr>' +
      '<tr><td style="padding:8px;border:1px solid #dee2e6"><strong>Fecha</strong></td>' +
          '<td style="padding:8px;border:1px solid #dee2e6">' + fecha + '</td></tr>' +
      '<tr><td style="padding:8px;border:1px solid #dee2e6"><strong>Bloque(s)</strong></td>' +
          '<td style="padding:8px;border:1px solid #dee2e6">' + bloquesText + '</td></tr>' +
      '<tr><td style="padding:8px;border:1px solid #dee2e6"><strong>Actividad</strong></td>' +
          '<td style="padding:8px;border:1px solid #dee2e6">' + (actividad || '-') + '</td></tr>' +
    '</table>' +
    '<hr>' +
    '<p style="color:#6c757d;font-size:12px">Sistema de Gesti&oacute;n de Labs de SJO</p>' +
    '</div>';

  MailApp.sendEmail({
    to: email,
    subject: 'Reserva cancelada — ' + labName + ' — ' + fecha,
    htmlBody: html
  });
}

// --- Crear reserva ---

function createReservation(body) {
  const { labId, fecha, email, actividad, equipos } = body;
  // Soporta bloqueId (único) o bloqueIds (array de múltiples bloques)
  const bloqueIds = body.bloqueIds || [body.bloqueId];

  if (!labId || !fecha || !bloqueIds.length || !email)
    return { ok: false, error: 'Faltan campos obligatorios' };

  const user = validateUser(email);
  if (!user)
    return { ok: false, error: 'Usuario no registrado' };

  const nombreReal = user.Nombre;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { ok: false, error: 'Sistema ocupado, intenta de nuevo' };
  }

  let result;
  let emailData = null;

  try {
    const resSheet = getSheet(SHEET_RESERVATIONS);
    const existentes = sheetToObjects(resSheet);

    // Verificar que ningún bloque esté ocupado
    for (const bloqueId of bloqueIds) {
      const ocupado = existentes.some(r =>
        String(r.LabID) === String(labId) &&
        formatDate(r.Fecha) === fecha &&
        String(r.BloqueID) === String(bloqueId)
      );
      if (ocupado) {
        const blocks = getCached('data_blocks', 600, () => sheetToObjects(getSheet(SHEET_BLOCKS)));
        const bloque = blocks.find(b => String(b.ID) === String(bloqueId));
        return { ok: false, error: 'Ya reservado: ' + (bloque ? bloque.Etiqueta : 'Bloque ' + bloqueId) };
      }
    }

    // Validar equipos — inline con datos ya cargados + cached equipment catalog
    if (equipos && equipos.length > 0) {
      const equipCatalog = getCached('data_equipment', 600, () => sheetToObjects(getSheet(SHEET_EQUIPMENT)));
      const resEquipos = sheetToObjects(getSheet(SHEET_RES_EQUIPMENT));

      const relevantes = equipCatalog.filter(eq => String(eq.LabID) === '' || String(eq.LabID) === String(labId));
      const resBloque = existentes.filter(r => formatDate(r.Fecha) === fecha && String(r.BloqueID) === String(bloqueIds[0]));
      const resIds = resBloque.map(r => String(r.ID));
      const eqReservados = resEquipos.filter(re => resIds.includes(String(re.ReservaID)));

      for (const eq of equipos) {
        const info = relevantes.find(d => String(d.ID) === String(eq.equipoId));
        if (!info) return { ok: false, error: 'Equipo no encontrado' };
        const reservados = eqReservados.filter(re => String(re.EquipoID) === String(eq.equipoId))
          .reduce((sum, re) => sum + Number(re.Cantidad), 0);
        if (eq.cantidad > Number(info.Cantidad) - reservados)
          return { ok: false, error: 'Sin disponibilidad de: ' + info.Nombre };
      }
    }

    let maxId = existentes.length > 0
      ? Math.max(...existentes.map(r => Number(r.ID)))
      : 0;

    const createdIds = [];
    const now = new Date().toISOString();

    // Batch: collect all rows first
    const reservationRows = [];
    const equipmentRows = [];
    for (const bloqueId of bloqueIds) {
      maxId++;
      reservationRows.push([maxId, labId, fecha, bloqueId, email, nombreReal, actividad || '', now]);
      createdIds.push(maxId);
      if (equipos && equipos.length > 0) {
        equipos.forEach(eq => equipmentRows.push([maxId, eq.equipoId, eq.cantidad]));
      }
    }

    // Batch write reservations
    const lastRow = resSheet.getLastRow();
    resSheet.getRange(lastRow + 1, 1, reservationRows.length, 8).setValues(reservationRows);

    // Batch write equipment
    if (equipmentRows.length > 0) {
      const eqSheet = getSheet(SHEET_RES_EQUIPMENT);
      eqSheet.getRange(eqSheet.getLastRow() + 1, 1, equipmentRows.length, 3).setValues(equipmentRows);
    }

    // Invalidate res_equip cache after write
    CacheService.getScriptCache().remove('data_res_equip');

    // Prepare email data (resolve names while still in lock)
    const labs = getCached('data_labs', 600, () => sheetToObjects(getSheet(SHEET_LABS)));
    const blocks = getCached('data_blocks', 600, () => sheetToObjects(getSheet(SHEET_BLOCKS)));
    const labInfo = labs.find(l => String(l.ID) === String(labId));
    const bloqueLabels = bloqueIds.map(bid => {
      const b = blocks.find(bl => String(bl.ID) === String(bid));
      return b ? b.Etiqueta : 'Bloque ' + bid;
    });
    const equipoNames = equipos ? equipos.map(eq => {
      const equipCatalog = getCached('data_equipment', 600, () => sheetToObjects(getSheet(SHEET_EQUIPMENT)));
      const info = equipCatalog.find(e => String(e.ID) === String(eq.equipoId));
      return { nombre: info ? info.Nombre : 'Equipo ' + eq.equipoId, cantidad: eq.cantidad };
    }) : [];

    emailData = {
      labName: labInfo ? labInfo.Nombre : 'Lab ' + labId,
      fecha,
      bloques: bloqueLabels,
      actividad,
      equipos: equipoNames
    };

    result = { ok: true, data: { ids: createdIds, count: createdIds.length } };
  } finally {
    lock.releaseLock();
  }

  // Email FUERA del lock
  if (emailData) {
    try { sendConfirmationEmail(email, nombreReal, emailData); } catch(e) { /* no bloquear si falla email */ }
  }

  return result;
}

// --- Cancelar reserva ---

function cancelReservation(body) {
  const { reservaId, email } = body;

  if (!reservaId || !email)
    return { ok: false, error: 'Faltan reservaId y email' };

  // Validar usuario
  const user = validateUser(email);
  if (!user)
    return { ok: false, error: 'Usuario no registrado' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { ok: false, error: 'Sistema ocupado, intenta de nuevo' };
  }

  let result;
  let emailData = null;
  const nombreReal = user.Nombre;

  try {
    const resSheet = getSheet(SHEET_RESERVATIONS);
    const data = resSheet.getDataRange().getValues();

    let rowToDelete = -1;
    let reservaRow = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(reservaId) && String(data[i][4]).trim().toLowerCase() === email.trim().toLowerCase()) {
        rowToDelete = i + 1;
        reservaRow = data[i];
        break;
      }
    }

    if (rowToDelete === -1)
      return { ok: false, error: 'Reserva no encontrada o email no coincide' };

    // Collect email data before deleting
    const labs = getCached('data_labs', 600, () => sheetToObjects(getSheet(SHEET_LABS)));
    const blocks = getCached('data_blocks', 600, () => sheetToObjects(getSheet(SHEET_BLOCKS)));
    const labInfo = labs.find(l => String(l.ID) === String(reservaRow[1]));
    const blockInfo = blocks.find(b => String(b.ID) === String(reservaRow[3]));

    emailData = {
      labName: labInfo ? labInfo.Nombre : 'Lab ' + reservaRow[1],
      fecha: formatDate(reservaRow[2]),
      bloques: [blockInfo ? blockInfo.Etiqueta : 'Bloque ' + reservaRow[3]],
      actividad: reservaRow[6] || ''
    };

    resSheet.deleteRow(rowToDelete);

    const eqSheet = getSheet(SHEET_RES_EQUIPMENT);
    const eqData = eqSheet.getDataRange().getValues();
    for (let i = eqData.length - 1; i >= 1; i--) {
      if (String(eqData[i][0]) === String(reservaId)) {
        eqSheet.deleteRow(i + 1);
      }
    }

    // Invalidate res_equip cache after write
    CacheService.getScriptCache().remove('data_res_equip');

    result = { ok: true };
  } finally {
    lock.releaseLock();
  }

  // Email FUERA del lock
  if (emailData) {
    try { sendCancellationEmail(email, nombreReal, emailData); } catch(e) { /* no bloquear si falla email */ }
  }

  return result;
}
