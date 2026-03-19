const { getUserEmail } = require('../shared/auth');
const {
  getEntity, getByPartition,
  upsertEntity
} = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const email = getUserEmail(req);
    if (!email) {
      return { status: 401, body: { ok: false, error: 'No autenticado' } };
    }

    const { slots, actividad, recurrenciaGrupo, comentarios, equipos, responsable } = req.body;

    if (!slots || !slots.length) {
      return { body: { ok: false, error: 'Faltan campos obligatorios' } };
    }

    const [user, salasRaw, bloquesRaw, equiposCatalog] = await Promise.all([
      getEntity('Usuarios', 'usuarios', email),
      getByPartition('Salas', 'salas'),
      getByPartition('Bloques', 'bloques'),
      getByPartition('Equipos', 'equipos')
    ]);

    if (!user) {
      return { status: 403, body: { ok: false, error: 'Usuario no registrado' } };
    }

    const nombreReal = user.Nombre;
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
        return {
          body: {
            ok: false,
            error: `Ya reservado: ${s.fecha} ${bloque ? bloque.Etiqueta : 'Bloque ' + s.bloqueId}`
          }
        };
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
            return { body: { ok: false, error: `Equipo no encontrado: ${eqId}` } };
          }

          const cantidadTotal = Number(equipo.Cantidad);
          const usados = eqReservas.filter(r =>
            r.Fecha === sg.fecha &&
            String(r.BloqueID) === String(sg.bloqueId) &&
            String(r.EquipoID) === String(eqId)
          ).length;

          if (usados >= cantidadTotal) {
            const bloque = bloques.find(b => b.ID === Number(sg.bloqueId));
            return {
              body: {
                ok: false,
                error: `Equipo "${equipo.Nombre}" no disponible: ${sg.fecha} ${bloque ? bloque.Etiqueta : 'Bloque ' + sg.bloqueId}`
              }
            };
          }
        }
      }
    }

    const responsableStr = responsable || nombreReal;
    const now = new Date().toISOString();
    const comentarioStr = comentarios || '';
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

    await Promise.all(allWrites);

    return {
      body: { ok: true, data: { ids: createdIds, count: createdIds.length } }
    };
  } catch (err) {
    context.log.error('createReservation error:', err);
    return { status: 500, body: { ok: false, error: err.message } };
  }
};

function generateId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}
