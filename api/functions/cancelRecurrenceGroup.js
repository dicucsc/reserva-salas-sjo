const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const { getByPartitionRange, deleteEntity } = require('../shared/tableClient');

app.http('cancelRecurrenceGroup', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cancelRecurrenceGroup',
  handler: async (request, context) => {
    try {
      const email = getUserEmail(request);
      if (!email) {
        return { status: 401, jsonBody: { ok: false, error: 'No autenticado' } };
      }

      const body = await request.json();
      const { recurrenciaGrupo } = body;

      if (!recurrenciaGrupo) {
        return { jsonBody: { ok: false, error: 'Falta recurrenciaGrupo' } };
      }

      // Search all reservations for this recurrence group
      const now = new Date();
      const year = now.getFullYear();
      const allReservas = await getByPartitionRange('Reservas', `${year - 1}-01`, `${year + 1}-12`);

      const matching = allReservas.filter(r =>
        r.Recurrencia === recurrenciaGrupo &&
        (r.Email || '').trim().toLowerCase() === email
      );

      if (matching.length === 0) {
        return { jsonBody: { ok: false, error: 'No se encontraron reservas del grupo' } };
      }

      const deletedIds = matching.map(r => r.rowKey);

      // Delete all matching reservations
      for (const reserva of matching) {
        await deleteEntity('Reservas', reserva.partitionKey, reserva.rowKey);
      }

      // Delete associated equipment reservations
      const months = [...new Set(matching.map(r => r.partitionKey))];
      for (const month of months) {
        const eqReservas = await getByPartitionRange('ReservaEquipos', month, month);
        for (const eq of eqReservas) {
          if (deletedIds.includes(eq.ReservaID)) {
            await deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey);
          }
        }
      }

      return { jsonBody: { ok: true, data: { canceladas: matching.length } } };
    } catch (err) {
      context.error('cancelRecurrenceGroup error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
