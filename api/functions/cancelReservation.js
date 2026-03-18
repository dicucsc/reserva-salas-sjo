const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const { getByPartitionRange, deleteEntity } = require('../shared/tableClient');

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
      const { reservaId } = body;

      if (!reservaId) {
        return { jsonBody: { ok: false, error: 'Falta reservaId' } };
      }

      // Search across all months for this reservation
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

      // Delete the reservation
      await deleteEntity('Reservas', reserva.partitionKey, reserva.rowKey);

      // Delete associated equipment reservations
      const month = reserva.partitionKey;
      const eqReservas = await getByPartitionRange('ReservaEquipos', month, month);
      for (const eq of eqReservas) {
        if (eq.ReservaID === String(reservaId)) {
          await deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey);
        }
      }

      return { jsonBody: { ok: true } };
    } catch (err) {
      context.error('cancelReservation error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
