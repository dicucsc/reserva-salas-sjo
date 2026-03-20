const { getUserEmail } = require('../shared/auth');
const { getEntity, getByPartition, upsertEntity } = require('../shared/tableClient');

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

    let rol = user.Rol || 'user';
    context.log.warn(`getUserProfile: email=${email}, user.Rol=${user.Rol}, resolved rol=${rol}`);

    // Bootstrap: if no admin exists in the system, promote this user to admin
    if (rol !== 'admin') {
      const allUsers = await getByPartition('Usuarios', 'usuarios');
      const roles = allUsers.map(u => ({ email: u.rowKey, Rol: u.Rol }));
      const hasAdmin = allUsers.some(u => u.Rol === 'admin');
      context.log.warn(`Bootstrap check: hasAdmin=${hasAdmin}, allUsers roles=${JSON.stringify(roles)}`);
      if (!hasAdmin) {
        rol = 'admin';
        try {
          await upsertEntity('Usuarios', {
            partitionKey: 'usuarios',
            rowKey: email,
            Nombre: user.Nombre || '',
            Rol: 'admin'
          });
          context.log.warn(`Bootstrap SUCCESS: promoted ${email} to admin`);
        } catch (upsertErr) {
          context.log.error(`Bootstrap FAILED: ${upsertErr.message}`, upsertErr);
          // Don't fail the login, just return as user role
          rol = 'user';
        }
      }
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        data: {
          Email: user.rowKey,
          Nombre: user.Nombre,
          Rol: rol
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
