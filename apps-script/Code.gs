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

// --- Validación de usuario ---

function validateUser(email) {
  if (!email) return null;
  const users = sheetToObjects(getSheet(SHEET_USERS));
  const normalized = email.trim().toLowerCase();
  return users.find(u => String(u.Email).trim().toLowerCase() === normalized) || null;
}

function doGet(e) {
  const action = e.parameter.action;

  try {
    switch (action) {
      case 'init': {
        const labs = sheetToObjects(getSheet(SHEET_LABS));
        const blocks = sheetToObjects(getSheet(SHEET_BLOCKS));
        const equipment = sheetToObjects(getSheet(SHEET_EQUIPMENT));
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
        return jsonResponse({ ok: true, data: sheetToObjects(getSheet(SHEET_LABS)) });

      case 'getBlocks':
        return jsonResponse({ ok: true, data: sheetToObjects(getSheet(SHEET_BLOCKS)) });

      case 'getEquipment':
        return jsonResponse({ ok: true, data: sheetToObjects(getSheet(SHEET_EQUIPMENT)) });

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
  const equipSheet = getSheet(SHEET_RES_EQUIPMENT);
  const allEquip = sheetToObjects(equipSheet);
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
  const equipos = sheetToObjects(getSheet(SHEET_EQUIPMENT));
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
        const bloque = sheetToObjects(getSheet(SHEET_BLOCKS)).find(b => String(b.ID) === String(bloqueId));
        return { ok: false, error: 'Ya reservado: ' + (bloque ? bloque.Etiqueta : 'Bloque ' + bloqueId) };
      }
    }

    // Validar equipos contra el primer bloque (referencia de disponibilidad)
    if (equipos && equipos.length > 0) {
      const disponibilidad = getEquipmentAvailability(labId, fecha, bloqueIds[0]);
      for (const eq of equipos) {
        const info = disponibilidad.find(d => String(d.ID) === String(eq.equipoId));
        if (!info)
          return { ok: false, error: 'Equipo no encontrado: ' + eq.equipoId };
        if (eq.cantidad > info.Disponible)
          return { ok: false, error: 'No hay suficiente disponibilidad de: ' + info.Nombre };
      }
    }

    let maxId = existentes.length > 0
      ? Math.max(...existentes.map(r => Number(r.ID)))
      : 0;

    const createdIds = [];
    const now = new Date().toISOString();
    const eqSheet = (equipos && equipos.length > 0) ? getSheet(SHEET_RES_EQUIPMENT) : null;

    // Crear una reserva por cada bloque seleccionado
    for (const bloqueId of bloqueIds) {
      maxId++;
      resSheet.appendRow([
        maxId, labId, fecha, bloqueId, email, nombreReal,
        actividad || '', now
      ]);

      if (eqSheet && equipos.length > 0) {
        equipos.forEach(eq => {
          eqSheet.appendRow([maxId, eq.equipoId, eq.cantidad]);
        });
      }

      createdIds.push(maxId);
    }

    return { ok: true, data: { ids: createdIds, count: createdIds.length } };
  } finally {
    lock.releaseLock();
  }
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

  try {
    const resSheet = getSheet(SHEET_RESERVATIONS);
    const data = resSheet.getDataRange().getValues();

    let rowToDelete = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(reservaId) && String(data[i][4]).trim().toLowerCase() === email.trim().toLowerCase()) {
        rowToDelete = i + 1;
        break;
      }
    }

    if (rowToDelete === -1)
      return { ok: false, error: 'Reserva no encontrada o email no coincide' };

    resSheet.deleteRow(rowToDelete);

    const eqSheet = getSheet(SHEET_RES_EQUIPMENT);
    const eqData = eqSheet.getDataRange().getValues();
    for (let i = eqData.length - 1; i >= 1; i--) {
      if (String(eqData[i][0]) === String(reservaId)) {
        eqSheet.deleteRow(i + 1);
      }
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
