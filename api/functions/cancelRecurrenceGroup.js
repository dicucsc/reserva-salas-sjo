const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const { getByPartitionRange, getByPartition, deleteEntity } = require('../shared/tableClient');

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

      // Search current year only (recurrence groups don't span years)
      const now = new Date();
      const year = now.getFullYear();
      const allReservas = await getByPartitionRange('Reservas', `${year}-01`, `${year}-12`);

      const matching = allReservas.filter(r =>
        r.Recurrencia === recurrenciaGrupo &&
        (r.Email || '').trim().toLowerCase() === email
      );

      if (matching.length === 0) {
        return { jsonBody: { ok: false, error: 'No se encontraron reservas del grupo' } };
      }

      const deletedIds = new Set(matching.map(r => r.rowKey));

      // Load equipment for affected months in parallel
      const months = [...new Set(matching.map(r => r.partitionKey))];
      const eqByMonth = await Promise.all(months.map(m => getByPartition('ReservaEquipos', m)));
      const allEq = eqByMonth.flat().filter(eq => deletedIds.has(eq.ReservaID));

      // Delete all reservations + equipment in parallel
      const deleteOps = [
        ...matching.map(r => deleteEntity('Reservas', r.partitionKey, r.rowKey)),
        ...allEq.map(eq => deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey))
      ];

      await Promise.all(deleteOps);

      return { jsonBody: { ok: true, data: { canceladas: matching.length } } };
    } catch (err) {
      context.error('cancelRecurrenceGroup error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
