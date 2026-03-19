const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const {
  getEntity, getByPartition,
  upsertEntity, deleteEntity
} = require('../shared/tableClient');

app.http('updateReservation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'updateReservation',
  handler: async (request, context) => {
    try {
      const email = getUserEmail(request);
      if (!email) {
        return { status: 401, jsonBody: { ok: false, error: 'No autenticado' } };
      }

      const body = await request.json();
      const { reservaId, fecha, actividad, comentarios, equipos, responsable } = body;

      if (!reservaId) {
        return { jsonBody: { ok: false, error: 'Falta reservaId' } };
      }

      // Direct O(1) lookup
      const month = fecha ? fecha.substring(0, 7) : null;
      let reserva = null;

      if (month) {
        reserva = await getEntity('Reservas', month, String(reservaId));
      }

      if (!reserva || (reserva.Email || '').trim().toLowerCase() !== email) {
        return { jsonBody: { ok: false, error: 'Reserva no encontrada o email no coincide' } };
      }

      // Update fields
      if (actividad !== undefined) reserva.Actividad = actividad || '';
      if (comentarios !== undefined) reserva.Comentarios = comentarios || '';
      if (responsable !== undefined) reserva.Responsable = responsable || '';

      const equiposArr = Array.isArray(equipos) ? equipos : [];
      reserva.Equipos = equiposArr.join(',');

      // Save reservation + load equipment data in parallel
      const [, eqReservas] = await Promise.all([
        upsertEntity('Reservas', reserva),
        getByPartition('ReservaEquipos', month)
      ]);

      // Delete old equipment entries in parallel
      const oldEq = eqReservas.filter(eq => eq.ReservaID === String(reservaId));
      if (oldEq.length > 0) {
        await Promise.all(oldEq.map(eq =>
          deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey)
        ));
      }

      // Create new equipment entries in parallel
      if (equiposArr.length > 0) {
        const [salasRaw, equiposCatalog] = await Promise.all([
          getByPartition('Salas', 'salas'),
          getByPartition('Equipos', 'equipos')
        ]);

        const sala = salasRaw.find(l => l.rowKey === String(reserva.SalaID));
        const respStr = responsable !== undefined ? (responsable || '') : (reserva.Responsable || '');

        await Promise.all(equiposArr.map(eqId => {
          const equipo = equiposCatalog.find(e => e.rowKey === String(eqId));
          return upsertEntity('ReservaEquipos', {
            partitionKey: month,
            rowKey: `${reservaId}_${eqId}`,
            ReservaID: String(reservaId),
            EquipoID: Number(eqId),
            NombreEquipo: equipo ? equipo.Nombre : '',
            Fecha: reserva.Fecha,
            BloqueID: Number(reserva.BloqueID),
            SalaID: Number(reserva.SalaID),
            NombreSala: sala ? sala.Nombre : '',
            Responsable: respStr
          });
        }));
      }

      return { jsonBody: { ok: true } };
    } catch (err) {
      context.error('updateReservation error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
