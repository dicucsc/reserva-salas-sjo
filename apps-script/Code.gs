/* ============================================================
   Sistema de Reserva de Salas – SJO
   Google Apps Script Backend
   Salas: Auditorio, Taller 1, Taller 2, Taller 3
   ============================================================ */

const SHEET_SALAS = 'Salas';
const SHEET_BLOQUES = 'Bloques';
const SHEET_RESERVAS = 'Reservas';
const SHEET_USUARIOS = 'Usuarios';
const SHEET_EQUIPOS = 'Equipos';
const SHEET_RESERVA_EQUIPOS = 'ReservaEquipos';

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
  const keys = ['data_salas', 'data_bloques', 'data_usuarios', 'data_equipos',
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

function loginUser(body) {
  const { email, password } = body;
  if (!email) return { ok: false, error: 'Falta el email' };
  if (!password) return { ok: false, error: 'Falta la contraseña' };

  const users = getCached('data_usuarios', 300, () => sheetToObjects(getSheet(SHEET_USUARIOS)));
  const normalized = email.trim().toLowerCase();
  const user = users.find(u => String(u.Email).trim().toLowerCase() === normalized);

  if (!user) return { ok: false, error: 'Usuario no registrado. Contacta al administrador.' };
  if (String(user.Password || '') !== String(password))
    return { ok: false, error: 'Contraseña incorrecta' };

  // No enviar password al frontend
  const safeUser = {};
  Object.keys(user).forEach(k => { if (k !== 'Password') safeUser[k] = user[k]; });
  return { ok: true, data: safeUser };
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
  const commentMap = new Map();
  const respMap = new Map();
  const users = [];
  const activities = [];
  const groups = [];
  const comments = [];
  const responsables = [];

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

    const comment = String(r.Comentarios || '');
    if (comment && !commentMap.has(comment)) {
      commentMap.set(comment, comments.length);
      comments.push(comment);
    }

    const resp = String(r.Responsable || r.Nombre || '');
    if (!respMap.has(resp)) {
      respMap.set(resp, responsables.length);
      responsables.push(resp);
    }
  });

  // Build compact records: [id, salaId, doy, bloqueId, userIdx, actIdx, groupIdx, commentIdx, equipStr, respIdx]
  const records = yearReservations.map(r => {
    const fecha = r.Fecha instanceof Date ? r.Fecha : new Date(formatDate(r.Fecha) + 'T00:00:00');
    const startOfYear = new Date(year, 0, 1);
    const doy = Math.floor((fecha - startOfYear) / 86400000) + 1;

    const email = String(r.Email || '').trim().toLowerCase();
    const act = String(r.Actividad || '');
    const rec = String(r.Recurrencia || '');
    const comment = String(r.Comentarios || '');
    const equip = String(r.Equipos || '');
    const resp = String(r.Responsable || r.Nombre || '');

    return [
      Number(r.ID),
      Number(r.SalaID),
      doy,
      Number(r.BloqueID),
      userMap.get(email),
      actMap.get(act),
      rec ? groupMap.get(rec) : -1,
      comment ? commentMap.get(comment) : -1,
      equip,
      respMap.get(resp)
    ];
  });

  return {
    y: year,
    u: users,
    a: activities,
    g: groups,
    c: comments,
    p: responsables,
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
        const equipos = getCached('data_equipos', 600, () => sheetToObjects(getSheet(SHEET_EQUIPOS)));
        return jsonResponse({ ok: true, data: { salas, bloques, equipos } });
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
      case 'login':
        return jsonResponse(loginUser(body));
      case 'createReservation':
        return jsonResponse(createReservation(body));
      case 'cancelReservation':
        return jsonResponse(cancelReservation(body));
      case 'cancelRecurrenceGroup':
        return jsonResponse(cancelRecurrenceGroup(body));
      case 'updateReservation':
        return jsonResponse(updateReservation(body));
      case 'changePassword':
        return jsonResponse(changePassword(body));
      default:
        return jsonResponse({ ok: false, error: 'Acción POST no válida: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Crear reserva ───────────────────────────────────────────

function createReservation(body) {
  const { slots, email, actividad, recurrenciaGrupo, comentarios, equipos, responsable } = body;

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

    // Cache salas/bloques/equipos once
    const salas = getCached('data_salas', 600, () => sheetToObjects(getSheet(SHEET_SALAS)));
    const bloques = getCached('data_bloques', 600, () => processBlocks(sheetToObjects(getSheet(SHEET_BLOQUES))));
    const equiposCatalog = getCached('data_equipos', 600, () => sheetToObjects(getSheet(SHEET_EQUIPOS)));

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

    // Validar disponibilidad de equipos
    const equiposArr = Array.isArray(equipos) ? equipos : [];
    const eqReservasSheet = getSheet(SHEET_RESERVA_EQUIPOS);
    if (equiposArr.length > 0 && eqReservasSheet) {
      const eqReservas = sheetToObjects(eqReservasSheet);
      const slotGroups = {};
      slots.forEach(s => {
        const key = s.fecha + '|' + s.bloqueId;
        if (!slotGroups[key]) slotGroups[key] = { fecha: s.fecha, bloqueId: s.bloqueId };
      });

      for (const sg of Object.values(slotGroups)) {
        for (const eqId of equiposArr) {
          const equipo = equiposCatalog.find(e => String(e.ID) === String(eqId));
          if (!equipo) return { ok: false, error: 'Equipo no encontrado: ' + eqId };

          const cantidadTotal = Number(equipo.Cantidad);
          const usados = eqReservas.filter(r =>
            formatDate(r.Fecha) === sg.fecha &&
            String(r.BloqueID) === String(sg.bloqueId) &&
            String(r.EquipoID) === String(eqId)
          ).length;

          if (usados >= cantidadTotal) {
            const bloque = bloques.find(b => String(b.ID) === String(sg.bloqueId));
            return { ok: false, error: 'Equipo "' + equipo.Nombre + '" no disponible: ' + sg.fecha + ' ' + (bloque ? bloque.Etiqueta : 'Bloque ' + sg.bloqueId) };
          }
        }
      }
    }

    const responsableStr = responsable || nombreReal;

    let maxId = existentes.length > 0
      ? Math.max(...existentes.map(r => Number(r.ID)))
      : 0;

    const createdIds = [];
    const now = new Date().toISOString();
    const rows = [];
    const comentarioStr = comentarios || '';
    const equiposStr = equiposArr.join(',');

    for (const s of slots) {
      maxId++;
      rows.push([maxId, Number(s.salaId), s.fecha, Number(s.bloqueId), email, nombreReal, actividad || '', recurrenciaGrupo || '', now, comentarioStr, equiposStr, responsableStr]);
      createdIds.push(maxId);
    }

    // Batch write reservations (12 columns)
    const lastRow = resSheet.getLastRow();
    resSheet.getRange(lastRow + 1, 1, rows.length, 12).setValues(rows);

    // Write equipment reservations
    if (equiposArr.length > 0 && eqReservasSheet) {
      const eqRows = [];
      rows.forEach(row => {
        const resId = row[0];
        const salaId = row[1];
        const fecha = row[2];
        const bloqueId = row[3];
        const sala = salas.find(l => l.ID === salaId);
        equiposArr.forEach(eqId => {
          const equipo = equiposCatalog.find(e => String(e.ID) === String(eqId));
          eqRows.push([resId, Number(eqId), equipo ? equipo.Nombre : '', fecha, bloqueId, salaId, sala ? sala.Nombre : '', responsableStr]);
        });
      });
      const eqLastRow = eqReservasSheet.getLastRow();
      eqReservasSheet.getRange(eqLastRow + 1, 1, eqRows.length, 8).setValues(eqRows);
    }

    invalidateCache();
    emailData = buildEmailData(slots, salas, bloques, actividad, comentarios, equiposArr, equiposCatalog, responsableStr);
    result = { ok: true, data: { ids: createdIds, count: createdIds.length } };
  } finally {
    lock.releaseLock();
  }

  // Email desactivado temporalmente
  // if (emailData) {
  //   try { sendConfirmationEmail(email, nombreReal, emailData); } catch(e) {}
  // }

  return result;
}

function buildEmailData(slots, salas, bloques, actividad, comentarios, equiposArr, equiposCatalog, responsable) {
  const equiposNombres = (equiposArr || []).map(eqId => {
    const eq = (equiposCatalog || []).find(e => String(e.ID) === String(eqId));
    return eq ? eq.Nombre : 'Equipo ' + eqId;
  });
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
    actividad,
    comentarios: comentarios || '',
    equipos: equiposNombres,
    responsable: responsable || ''
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

    // Limpiar equipos reservados
    const eqSheet = getSheet(SHEET_RESERVA_EQUIPOS);
    if (eqSheet) {
      const eqData = eqSheet.getDataRange().getValues();
      for (let j = eqData.length - 1; j >= 1; j--) {
        if (String(eqData[j][0]) === String(reservaId)) {
          eqSheet.deleteRow(j + 1);
        }
      }
    }

    invalidateCache();
    result = { ok: true };
  } finally {
    lock.releaseLock();
  }

  // Email desactivado temporalmente
  // if (emailData) {
  //   try { sendCancellationEmail(email, user.Nombre, emailData); } catch(e) {}
  // }

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
    const deletedIds = [];
    let count = 0;

    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][7]) === recurrenciaGrupo &&
          String(data[i][4]).trim().toLowerCase() === email.trim().toLowerCase()) {
        deletedIds.push(String(data[i][0]));
        resSheet.deleteRow(i + 1);
        count++;
      }
    }

    // Limpiar equipos reservados del grupo
    if (deletedIds.length > 0) {
      const eqSheet = getSheet(SHEET_RESERVA_EQUIPOS);
      if (eqSheet) {
        const eqData = eqSheet.getDataRange().getValues();
        for (let j = eqData.length - 1; j >= 1; j--) {
          if (deletedIds.includes(String(eqData[j][0]))) {
            eqSheet.deleteRow(j + 1);
          }
        }
      }
    }

    if (count > 0) {
      invalidateCache();
      return { ok: true, data: { canceladas: count } };
    }
    return { ok: false, error: 'No se encontraron reservas del grupo' };
  } finally {
    lock.releaseLock();
  }
}

// ── Editar reserva ──────────────────────────────────────────

function updateReservation(body) {
  const { reservaId, email, actividad, comentarios, equipos, responsable } = body;

  if (!reservaId || !email)
    return { ok: false, error: 'Faltan campos obligatorios' };

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

    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(reservaId) &&
          String(data[i][4]).trim().toLowerCase() === email.trim().toLowerCase()) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1)
      return { ok: false, error: 'Reserva no encontrada o email no coincide' };

    // Actualizar campos: Actividad(7), Comentarios(10), Equipos(11), Responsable(12)
    if (actividad !== undefined) resSheet.getRange(rowIndex, 7).setValue(actividad || '');
    if (comentarios !== undefined) resSheet.getRange(rowIndex, 10).setValue(comentarios || '');
    if (responsable !== undefined) resSheet.getRange(rowIndex, 12).setValue(responsable || '');

    const equiposArr = Array.isArray(equipos) ? equipos : [];
    resSheet.getRange(rowIndex, 11).setValue(equiposArr.join(','));

    // Actualizar ReservaEquipos
    const eqSheet = getSheet(SHEET_RESERVA_EQUIPOS);
    if (eqSheet) {
      // Eliminar equipos anteriores
      const eqData = eqSheet.getDataRange().getValues();
      for (let j = eqData.length - 1; j >= 1; j--) {
        if (String(eqData[j][0]) === String(reservaId)) {
          eqSheet.deleteRow(j + 1);
        }
      }

      // Re-escribir equipos nuevos
      if (equiposArr.length > 0) {
        const equiposCatalog = getCached('data_equipos', 600, () => sheetToObjects(getSheet(SHEET_EQUIPOS)));
        const salas = getCached('data_salas', 600, () => sheetToObjects(getSheet(SHEET_SALAS)));
        const fecha = formatDate(data[rowIndex - 1][2]);
        const bloqueId = data[rowIndex - 1][3];
        const salaId = data[rowIndex - 1][1];
        const sala = salas.find(l => l.ID === salaId);
        const respStr = responsable || data[rowIndex - 1][11] || '';

        const eqRows = [];
        equiposArr.forEach(eqId => {
          const equipo = equiposCatalog.find(e => String(e.ID) === String(eqId));
          eqRows.push([Number(reservaId), Number(eqId), equipo ? equipo.Nombre : '', fecha, bloqueId, salaId, sala ? sala.Nombre : '', respStr]);
        });
        const eqLastRow = eqSheet.getLastRow();
        eqSheet.getRange(eqLastRow + 1, 1, eqRows.length, 8).setValues(eqRows);
      }
    }

    invalidateCache();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ── Cambiar contraseña ───────────────────────────────────────

function changePassword(body) {
  const { email, currentPassword, newPassword } = body;

  if (!email || !currentPassword || !newPassword)
    return { ok: false, error: 'Faltan campos obligatorios' };

  if (newPassword.length < 4)
    return { ok: false, error: 'La nueva contraseña debe tener al menos 4 caracteres' };

  const sheet = getSheet(SHEET_USUARIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const passCol = headers.indexOf('Password');

  if (passCol === -1)
    return { ok: false, error: 'Columna Password no encontrada' };

  const emailCol = headers.indexOf('Email');
  const normalized = email.trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailCol]).trim().toLowerCase() === normalized) {
      if (String(data[i][passCol] || '') !== String(currentPassword)) {
        return { ok: false, error: 'Contraseña actual incorrecta' };
      }
      sheet.getRange(i + 1, passCol + 1).setValue(newPassword);
      invalidateCache();
      return { ok: true };
    }
  }

  return { ok: false, error: 'Usuario no encontrado' };
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
  const respLine = data.responsable ? '<p><strong>Responsable:</strong> ' + data.responsable + '</p>' : '';
  const commentLine = data.comentarios ? '<p><strong>Comentarios:</strong> ' + data.comentarios + '</p>' : '';
  const equipLine = data.equipos && data.equipos.length > 0 ? '<p><strong>Equipos:</strong> ' + data.equipos.join(', ') + '</p>' : '';
  const tableHtml = buildEmailHtml('Reserva Confirmada', '#059669', nombre, rows);
  const html = tableHtml.replace('</table>', '</table>' + actLine + respLine + commentLine + equipLine);

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
