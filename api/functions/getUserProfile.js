const { app } = require('@azure/functions');
const { getUserEmail } = require('../shared/auth');
const { getEntity } = require('../shared/tableClient');

app.http('getUserProfile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'getUserProfile',
  handler: async (request, context) => {
    try {
      const email = getUserEmail(request);
      if (!email) {
        return { status: 401, jsonBody: { ok: false, error: 'No autenticado' } };
      }

      const user = await getEntity('Usuarios', 'usuarios', email);
      if (!user) {
        return { status: 403, jsonBody: { ok: false, error: 'Usuario no registrado. Contacta al administrador.' } };
      }

      return {
        jsonBody: {
          ok: true,
          data: {
            Email: user.rowKey,
            Nombre: user.Nombre,
            Rol: user.Rol || 'user'
          }
        }
      };
    } catch (err) {
      context.error('getUserProfile error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
