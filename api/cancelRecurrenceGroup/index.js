const { getUserEmail } = require('../shared/auth');
const { getByPartitionRange, getByPartition, deleteEntity } = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const email = getUserEmail(req);
    if (!email) {
      context.res = { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No autenticado' }) };
      return;
    }

    const { recurrenciaGrupo } = req.body;

    if (!recurrenciaGrupo) {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Falta recurrenciaGrupo' }) };
      return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const allReservas = await getByPartitionRange('Reservas', `${year}-01`, `${year}-12`);

    const matching = allReservas.filter(r =>
      r.Recurrencia === recurrenciaGrupo &&
      (r.Email || '').trim().toLowerCase() === email
    );

    if (matching.length === 0) {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No se encontraron reservas del grupo' }) };
      return;
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

    context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: { canceladas: matching.length } }) };
    return;
  } catch (err) {
    context.log.error('cancelRecurrenceGroup error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
    return;
  }
};
