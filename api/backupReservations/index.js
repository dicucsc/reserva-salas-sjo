const { getAuthenticatedUser } = require('../shared/auth');
const { getAll } = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      context.res = { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No autenticado' }) };
      return;
    }
    if (user.rol !== 'admin') {
      context.res = { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Solo administradores' }) };
      return;
    }

    const data = await getAll('Reservas');
    const timestamp = new Date().toISOString();

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="backup-reservas-${timestamp.substring(0, 10)}.json"`
      },
      body: JSON.stringify({ ok: true, count: data.length, timestamp, data })
    };
  } catch (err) {
    context.log.error('backupReservations error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
