const { getUserEmail } = require('../shared/auth');
const { getEntity, getByPartition, deleteEntity } = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const email = getUserEmail(req);
    if (!email) {
      return { status: 401, body: { ok: false, error: 'No autenticado' } };
    }

    const { reservaId, fecha } = req.body;

    if (!reservaId) {
      return { body: { ok: false, error: 'Falta reservaId' } };
    }

    const month = fecha ? fecha.substring(0, 7) : null;
    let reserva = null;

    if (month) {
      reserva = await getEntity('Reservas', month, String(reservaId));
    }

    if (!reserva || (reserva.Email || '').trim().toLowerCase() !== email) {
      return { body: { ok: false, error: 'Reserva no encontrada o email no coincide' } };
    }

    const deleteOps = [deleteEntity('Reservas', reserva.partitionKey, reserva.rowKey)];

    const eqReservas = await getByPartition('ReservaEquipos', month);
    const eqToDelete = eqReservas.filter(eq => eq.ReservaID === String(reservaId));
    eqToDelete.forEach(eq => {
      deleteOps.push(deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey));
    });

    await Promise.all(deleteOps);

    return { body: { ok: true } };
  } catch (err) {
    context.log.error('cancelReservation error:', err);
    return { status: 500, body: { ok: false, error: err.message } };
  }
};
