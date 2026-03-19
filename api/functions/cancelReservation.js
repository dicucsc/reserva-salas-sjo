const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const { getEntity, getByPartition, deleteEntity } = require('../shared/tableClient');

app.http('cancelReservation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cancelReservation',
  handler: async (request, context) => {
    try {
      const email = getUserEmail(request);
      if (!email) {
        return { status: 401, jsonBody: { ok: false, error: 'No autenticado' } };
      }

      const body = await request.json();
      const { reservaId, fecha } = body;

      if (!reservaId) {
        return { jsonBody: { ok: false, error: 'Falta reservaId' } };
      }

      // Direct O(1) lookup using fecha to derive partition key
      const month = fecha ? fecha.substring(0, 7) : null;
      let reserva = null;

      if (month) {
        reserva = await getEntity('Reservas', month, String(reservaId));
      }

      // Verify ownership
      if (!reserva || (reserva.Email || '').trim().toLowerCase() !== email) {
        return { jsonBody: { ok: false, error: 'Reserva no encontrada o email no coincide' } };
      }

      // Delete reservation and equipment in parallel
      const deleteOps = [deleteEntity('Reservas', reserva.partitionKey, reserva.rowKey)];

      // Find and delete associated equipment reservations
      const eqReservas = await getByPartition('ReservaEquipos', month);
      const eqToDelete = eqReservas.filter(eq => eq.ReservaID === String(reservaId));
      eqToDelete.forEach(eq => {
        deleteOps.push(deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey));
      });

      await Promise.all(deleteOps);

      return { jsonBody: { ok: true } };
    } catch (err) {
      context.error('cancelReservation error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
