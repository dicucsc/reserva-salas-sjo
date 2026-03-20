const { getAuthenticatedUser } = require('../shared/auth');
const { getEntity, getByPartition, deleteEntity } = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      context.res = { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No autenticado' }) };
      return;
    }
    if (user.rol === 'viewer') {
      context.res = { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Sin permisos para cancelar' }) };
      return;
    }

    const { reservaId, fecha } = req.body;

    if (!reservaId) {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Falta reservaId' }) };
      return;
    }

    const month = fecha ? fecha.substring(0, 7) : null;
    let reserva = null;

    if (month) {
      reserva = await getEntity('Reservas', month, String(reservaId));
    }

    if (!reserva) {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Reserva no encontrada' }) };
      return;
    }

    // Admin can cancel any reservation; others only their own
    if (user.rol !== 'admin' && (reserva.Email || '').trim().toLowerCase() !== user.email) {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No puedes cancelar reservas de otros usuarios' }) };
      return;
    }

    const deleteOps = [deleteEntity('Reservas', reserva.partitionKey, reserva.rowKey)];

    const eqReservas = await getByPartition('ReservaEquipos', month);
    const eqToDelete = eqReservas.filter(eq => eq.ReservaID === String(reservaId));
    eqToDelete.forEach(eq => {
      deleteOps.push(deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey));
    });

    await Promise.all(deleteOps);

    context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    return;
  } catch (err) {
    context.log.error('cancelReservation error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
    return;
  }
};
