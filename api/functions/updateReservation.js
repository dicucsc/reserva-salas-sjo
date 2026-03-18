const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const {
  getByPartition, getByPartitionRange,
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
      const { reservaId, actividad, comentarios, equipos, responsable } = body;

      if (!reservaId) {
        return { jsonBody: { ok: false, error: 'Falta reservaId' } };
      }

      // Find the reservation
      const now = new Date();
      const year = now.getFullYear();
      const allReservas = await getByPartitionRange('Reservas', `${year - 1}-01`, `${year + 1}-12`);

      const reserva = allReservas.find(r =>
        r.rowKey === String(reservaId) &&
        (r.Email || '').trim().toLowerCase() === email
      );

      if (!reserva) {
        return { jsonBody: { ok: false, error: 'Reserva no encontrada o email no coincide' } };
      }

      // Update fields
      if (actividad !== undefined) reserva.Actividad = actividad || '';
      if (comentarios !== undefined) reserva.Comentarios = comentarios || '';
      if (responsable !== undefined) reserva.Responsable = responsable || '';

      const equiposArr = Array.isArray(equipos) ? equipos : [];
      reserva.Equipos = equiposArr.join(',');

      await upsertEntity('Reservas', reserva);

      // Update equipment reservations
      const month = reserva.partitionKey;
      const eqReservas = await getByPartitionRange('ReservaEquipos', month, month);

      // Delete old equipment entries for this reservation
      for (const eq of eqReservas) {
        if (eq.ReservaID === String(reservaId)) {
          await deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey);
        }
      }

      // Create new equipment entries
      if (equiposArr.length > 0) {
        const [salasRaw, equiposCatalog] = await Promise.all([
          getByPartition('Salas', 'salas'),
          getByPartition('Equipos', 'equipos')
        ]);

        const sala = salasRaw.find(l => l.rowKey === String(reserva.SalaID));
        const respStr = responsable !== undefined ? (responsable || '') : (reserva.Responsable || '');

        for (const eqId of equiposArr) {
          const equipo = equiposCatalog.find(e => e.rowKey === String(eqId));
          await upsertEntity('ReservaEquipos', {
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
        }
      }

      return { jsonBody: { ok: true } };
    } catch (err) {
      context.error('updateReservation error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
