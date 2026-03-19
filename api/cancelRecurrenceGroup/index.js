const { getUserEmail } = require('../shared/auth');
const { getByPartitionRange, getByPartition, deleteEntity } = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const email = getUserEmail(req);
    if (!email) {
      return { status: 401, body: { ok: false, error: 'No autenticado' } };
    }

    const { recurrenciaGrupo } = req.body;

    if (!recurrenciaGrupo) {
      return { body: { ok: false, error: 'Falta recurrenciaGrupo' } };
    }

    const now = new Date();
    const year = now.getFullYear();
    const allReservas = await getByPartitionRange('Reservas', `${year}-01`, `${year}-12`);

    const matching = allReservas.filter(r =>
      r.Recurrencia === recurrenciaGrupo &&
      (r.Email || '').trim().toLowerCase() === email
    );

    if (matching.length === 0) {
      return { body: { ok: false, error: 'No se encontraron reservas del grupo' } };
    }

    const deletedIds = new Set(matching.map(r => r.rowKey));

    const months = [...new Set(matching.map(r => r.partitionKey))];
    const eqByMonth = await Promise.all(months.map(m => getByPartition('ReservaEquipos', m)));
    const allEq = eqByMonth.flat().filter(eq => deletedIds.has(eq.ReservaID));

    const deleteOps = [
      ...matching.map(r => deleteEntity('Reservas', r.partitionKey, r.rowKey)),
      ...allEq.map(eq => deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey))
    ];

    await Promise.all(deleteOps);

    return { body: { ok: true, data: { canceladas: matching.length } } };
  } catch (err) {
    context.log.error('cancelRecurrenceGroup error:', err);
    return { status: 500, body: { ok: false, error: err.message } };
  }
};
