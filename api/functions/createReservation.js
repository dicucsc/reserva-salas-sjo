const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const {
  getEntity, getByPartition,
  upsertEntity
} = require('../shared/tableClient');

app.http('createReservation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'createReservation',
  handler: async (request, context) => {
    try {
      const email = getUserEmail(request);
      if (!email) {
        return { status: 401, jsonBody: { ok: false, error: 'No autenticado' } };
      }

      const body = await request.json();
      const { slots, actividad, recurrenciaGrupo, comentarios, equipos, responsable } = body;

      if (!slots || !slots.length) {
        return { jsonBody: { ok: false, error: 'Faltan campos obligatorios' } };
      }

      // Validate user
      const user = await getEntity('Usuarios', 'usuarios', email);
      if (!user) {
        return { status: 403, jsonBody: { ok: false, error: 'Usuario no registrado' } };
      }

      const nombreReal = user.Nombre;

      // Load reference data
      const [salasRaw, bloquesRaw, equiposCatalog] = await Promise.all([
        getByPartition('Salas', 'salas'),
        getByPartition('Bloques', 'bloques'),
        getByPartition('Equipos', 'equipos')
      ]);

      const bloques = bloquesRaw.map(b => ({
        ID: Number(b.rowKey),
        Etiqueta: b.Etiqueta || `${b.HoraInicio} - ${b.HoraFin}`
      }));

      // Collect all months involved
      const monthsNeeded = new Set();
      slots.forEach(s => {
        monthsNeeded.add(s.fecha.substring(0, 7));
      });

      // Load existing reservations for affected months
      let existingReservations = [];
      for (const month of monthsNeeded) {
        const monthRes = await getByPartition('Reservas', month);
        existingReservations = existingReservations.concat(monthRes);
      }

      // Check for conflicts
      for (const s of slots) {
        const conflict = existingReservations.find(r =>
          String(r.SalaID) === String(s.salaId) &&
          r.Fecha === s.fecha &&
          String(r.BloqueID) === String(s.bloqueId)
        );
        if (conflict) {
          const bloque = bloques.find(b => b.ID === Number(s.bloqueId));
          return {
            jsonBody: {
              ok: false,
              error: `Ya reservado: ${s.fecha} ${bloque ? bloque.Etiqueta : 'Bloque ' + s.bloqueId}`
            }
          };
        }
      }

      // Validate equipment availability
      const equiposArr = Array.isArray(equipos) ? equipos : [];
      if (equiposArr.length > 0) {
        let eqReservas = [];
        for (const month of monthsNeeded) {
          const monthEq = await getByPartition('ReservaEquipos', month);
          eqReservas = eqReservas.concat(monthEq);
        }

        const slotGroups = {};
        slots.forEach(s => {
          const key = `${s.fecha}|${s.bloqueId}`;
          if (!slotGroups[key]) slotGroups[key] = { fecha: s.fecha, bloqueId: s.bloqueId };
        });

        for (const sg of Object.values(slotGroups)) {
          for (const eqId of equiposArr) {
            const equipo = equiposCatalog.find(e => e.rowKey === String(eqId));
            if (!equipo) {
              return { jsonBody: { ok: false, error: `Equipo no encontrado: ${eqId}` } };
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
                jsonBody: {
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

      // Create reservation entities
      const reservationEntities = [];
      const eqEntities = [];

      for (const s of slots) {
        const month = s.fecha.substring(0, 7); // YYYY-MM
        const id = generateId();
        createdIds.push(id);

        reservationEntities.push({
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
        });

        // Equipment reservations
        if (equiposArr.length > 0) {
          const sala = salasRaw.find(l => l.rowKey === String(s.salaId));
          for (const eqId of equiposArr) {
            const equipo = equiposCatalog.find(e => e.rowKey === String(eqId));
            eqEntities.push({
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
            });
          }
        }
      }

      // Write all entities
      for (const entity of reservationEntities) {
        await upsertEntity('Reservas', entity);
      }
      for (const entity of eqEntities) {
        await upsertEntity('ReservaEquipos', entity);
      }

      return {
        jsonBody: { ok: true, data: { ids: createdIds, count: createdIds.length } }
      };
    } catch (err) {
      context.error('createReservation error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});

// Generate a unique numeric-ish ID using timestamp + random
function generateId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}
