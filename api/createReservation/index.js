const { getAuthenticatedUser } = require('../shared/auth');
const {
  getByPartition,
  upsertEntity
} = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      context.res = { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No autenticado' }) };
      return;
    }
    if (user.rol === 'viewer') {
      context.res = { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Sin permisos para reservar' }) };
      return;
    }
    const email = user.email;

    const { slots, actividad, recurrenciaGrupo, comentarios, equipos, responsable, descripcion } = req.body;

    if (!slots || !slots.length) {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Faltan campos obligatorios' }) };
      return;
    }

    const [salasRaw, bloquesRaw, equiposCatalog] = await Promise.all([
      getByPartition('Salas', 'salas'),
      getByPartition('Bloques', 'bloques'),
      getByPartition('Equipos', 'equipos')
    ]);

    const nombreReal = user.nombre;
    const bloques = bloquesRaw.map(b => ({
      ID: Number(b.rowKey),
      Etiqueta: b.Etiqueta || `${b.HoraInicio} - ${b.HoraFin}`
    }));

    const monthsNeeded = [...new Set(slots.map(s => s.fecha.substring(0, 7)))];

    const [monthReservations, monthEquipment] = await Promise.all([
      Promise.all(monthsNeeded.map(m => getByPartition('Reservas', m))),
      equipos && equipos.length > 0
        ? Promise.all(monthsNeeded.map(m => getByPartition('ReservaEquipos', m)))
        : Promise.resolve([])
    ]);

    const existingReservations = monthReservations.flat();

    for (const s of slots) {
      const conflict = existingReservations.find(r =>
        String(r.SalaID) === String(s.salaId) &&
        r.Fecha === s.fecha &&
        String(r.BloqueID) === String(s.bloqueId)
      );
      if (conflict) {
        const bloque = bloques.find(b => b.ID === Number(s.bloqueId));
        context.res = {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ok: false,
            error: `Ya reservado: ${s.fecha} ${bloque ? bloque.Etiqueta : 'Bloque ' + s.bloqueId}`
          })
        };
        return;
      }
    }

    const equiposArr = Array.isArray(equipos) ? equipos : [];
    if (equiposArr.length > 0) {
      const eqReservas = monthEquipment.flat();

      const slotGroups = {};
      slots.forEach(s => {
        const key = `${s.fecha}|${s.bloqueId}`;
        if (!slotGroups[key]) slotGroups[key] = { fecha: s.fecha, bloqueId: s.bloqueId };
      });

      for (const sg of Object.values(slotGroups)) {
        for (const eqId of equiposArr) {
          const equipo = equiposCatalog.find(e => e.rowKey === String(eqId));
          if (!equipo) {
            context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: `Equipo no encontrado: ${eqId}` }) };
            return;
          }

          const cantidadTotal = Number(equipo.Cantidad);
          const usados = eqReservas.filter(r =>
            r.Fecha === sg.fecha &&
            String(r.BloqueID) === String(sg.bloqueId) &&
            String(r.EquipoID) === String(eqId)
          ).length;

          if (usados >= cantidadTotal) {
            const bloque = bloques.find(b => b.ID === Number(sg.bloqueId));
            context.res = {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ok: false,
                error: `Equipo "${equipo.Nombre}" no disponible: ${sg.fecha} ${bloque ? bloque.Etiqueta : 'Bloque ' + sg.bloqueId}`
              })
            };
            return;
          }
        }
      }
    }

    const responsableStr = responsable || nombreReal;
    const now = new Date().toISOString();
    const comentarioStr = comentarios || '';
    const descripcionStr = descripcion || '';
    const equiposStr = equiposArr.join(',');
    const createdIds = [];

    const allWrites = [];

    for (const s of slots) {
      const month = s.fecha.substring(0, 7);
      const id = generateId();
      createdIds.push(id);

      allWrites.push(upsertEntity('Reservas', {
        partitionKey: month,
        rowKey: String(id),
        SalaID: Number(s.salaId),
        Fecha: s.fecha,
        BloqueID: Number(s.bloqueId),
        Email: email,
        Nombre: nombreReal,
        Actividad: actividad || '',
        Descripcion: descripcionStr,
        Recurrencia: recurrenciaGrupo || '',
        CreatedAt: now,
        Comentarios: comentarioStr,
        Equipos: equiposStr,
        Responsable: responsableStr
      }));

      if (equiposArr.length > 0) {
        const sala = salasRaw.find(l => l.rowKey === String(s.salaId));
        for (const eqId of equiposArr) {
          const equipo = equiposCatalog.find(e => e.rowKey === String(eqId));
          allWrites.push(upsertEntity('ReservaEquipos', {
            partitionKey: month,
            rowKey: `${id}_${eqId}`,
            ReservaID: String(id),
            EquipoID: Number(eqId),
            NombreEquipo: equipo ? equipo.Nombre : '',
            Fecha: s.fecha,
            BloqueID: Number(s.bloqueId),
            SalaID: Number(s.salaId),
            NombreSala: sala ? sala.Nombre : '',
            Responsable: responsableStr
          }));
        }
      }
    }

    const results = await Promise.allSettled(allWrites);
    const failures = results.filter(r => r.status === 'rejected');

    if (failures.length > 0) {
      context.log.error('Partial write failures:', failures.map(f => f.reason?.message));
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        data: { ids: createdIds, count: createdIds.length },
        ...(failures.length > 0 && { warning: `${failures.length} escritura(s) fallaron parcialmente` })
      })
    };
    return;
  } catch (err) {
    context.log.error('createReservation error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
    return;
  }
};

function generateId() {
  const crypto = require('crypto');
  return Date.now() * 1000 + crypto.randomBytes(2).readUInt16BE(0) % 1000;
}
