const { getAuthenticatedUser } = require('../shared/auth');
const {
  getEntity, getByPartition,
  upsertEntity, deleteEntity
} = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      context.res = { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No autenticado' }) };
      return;
    }
    if (user.rol === 'viewer') {
      context.res = { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Sin permisos para editar' }) };
      return;
    }

    const { reservaId, fecha, actividad, comentarios, equipos, responsable } = req.body;

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

    // Admin can edit any reservation; others only their own
    if (user.rol !== 'admin' && (reserva.Email || '').trim().toLowerCase() !== user.email) {
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No puedes editar reservas de otros usuarios' }) };
      return;
    }

    if (actividad !== undefined) reserva.Actividad = actividad || '';
    if (comentarios !== undefined) reserva.Comentarios = comentarios || '';
    if (responsable !== undefined) reserva.Responsable = responsable || '';

    const equiposArr = Array.isArray(equipos) ? equipos : [];
    reserva.Equipos = equiposArr.join(',');

    const [, eqReservas] = await Promise.all([
      upsertEntity('Reservas', reserva),
      getByPartition('ReservaEquipos', month)
    ]);

    const oldEq = eqReservas.filter(eq => eq.ReservaID === String(reservaId));
    if (oldEq.length > 0) {
      await Promise.all(oldEq.map(eq =>
        deleteEntity('ReservaEquipos', eq.partitionKey, eq.rowKey)
      ));
    }

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

    context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    return;
  } catch (err) {
    context.log.error('updateReservation error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
    return;
  }
};
