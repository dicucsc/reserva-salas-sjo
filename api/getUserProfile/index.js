const { getUserEmail } = require('../shared/auth');
const { getEntity } = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const email = getUserEmail(req);
    if (!email) {
      return { status: 401, body: { ok: false, error: 'No autenticado' } };
    }

    const user = await getEntity('Usuarios', 'usuarios', email);
    if (!user) {
      return { status: 403, body: { ok: false, error: 'Usuario no registrado. Contacta al administrador.' } };
    }

    return {
      body: {
        ok: true,
        data: {
          Email: user.rowKey,
          Nombre: user.Nombre,
          Rol: user.Rol || 'user'
        }
      }
    };
  } catch (err) {
    context.log.error('getUserProfile error:', err);
    return { status: 500, body: { ok: false, error: err.message } };
  }
};
