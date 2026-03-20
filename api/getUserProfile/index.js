const { getUserEmail } = require('../shared/auth');
const { getEntity } = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const email = getUserEmail(req);
    if (!email) {
      context.res = { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No autenticado' }) };
      return;
    }

    const user = await getEntity('Usuarios', 'usuarios', email);
    if (!user) {
      context.res = { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Usuario no registrado. Contacta al administrador.' }) };
      return;
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        data: {
          Email: user.rowKey,
          Nombre: user.Nombre,
          Rol: user.Rol || 'user'
        }
      })
    };
    return;
  } catch (err) {
    context.log.error('getUserProfile error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
    return;
  }
};
