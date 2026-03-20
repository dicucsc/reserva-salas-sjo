const { getByPartition, getByPartitionRange, getEntity, upsertEntity, deleteEntity } = require('../shared/tableClient');
const { getAuthenticatedUser } = require('../shared/auth');

const TABLES = {
  equipos: { table: 'Equipos', pk: 'equipos' },
  bloques: { table: 'Bloques', pk: 'bloques' },
  salas:   { table: 'Salas',   pk: 'salas' },
  usuarios: { table: 'Usuarios', pk: 'usuarios' }
};

const ROLE_PERMISSIONS = {
  admin: ['equipos', 'bloques', 'salas', 'usuarios'],
  user:  ['equipos'],
  viewer: []
};

async function checkEquipmentConflicts(equipoId, equipoNombre, newCantidad) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const endMonth = `${now.getFullYear() + 1}-12`;
  const eqReservas = await getByPartitionRange('ReservaEquipos', currentMonth, endMonth);

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const slotCounts = {};
  eqReservas.forEach(r => {
    if (String(r.EquipoID) === String(equipoId) && r.Fecha >= todayStr) {
      const key = `${r.Fecha}|${r.BloqueID}`;
      slotCounts[key] = (slotCounts[key] || 0) + 1;
    }
  });

  let conflictSlots = 0;
  for (const count of Object.values(slotCounts)) {
    if (count > newCantidad) conflictSlots++;
  }

  if (conflictSlots > 0) {
    return `Equipo ${equipoNombre}: demanda excede disponibilidad en ${conflictSlots} bloque${conflictSlots > 1 ? 's' : ''}`;
  }
  return null;
}

module.exports = async function (context, req) {
  try {
    // Auth + RBAC
    const user = await getAuthenticatedUser(req);
    if (!user) {
      context.res = { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No autenticado' }) };
      return;
    }

    const { resource, action, data } = req.body;

    const cfg = TABLES[resource];
    if (!cfg) {
      context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Recurso inválido' }) };
      return;
    }

    const allowed = ROLE_PERMISSIONS[user.rol] || [];
    if (!allowed.includes(resource)) {
      context.res = { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Sin permisos para este recurso' }) };
      return;
    }

    // === LIST ===
    if (action === 'list') {
      const raw = await getByPartition(cfg.table, cfg.pk);

      if (resource === 'usuarios') {
        const items = raw.map(e => ({
          Email: e.rowKey,
          Nombre: e.Nombre || '',
          Rol: e.Rol || 'user'
        })).sort((a, b) => a.Email.localeCompare(b.Email));
        context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: items }) };
        return;
      }

      const items = raw.map(e => {
        const item = { ID: Number(e.rowKey) };
        Object.keys(e).forEach(k => {
          if (!['partitionKey', 'rowKey', 'timestamp', 'etag'].includes(k)) {
            item[k] = e[k];
          }
        });
        return item;
      }).sort((a, b) => a.ID - b.ID);
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: items }) };
      return;
    }

    // === SAVE ===
    if (action === 'save') {
      if (resource === 'usuarios') {
        const email = (data.Email || '').trim().toLowerCase();
        if (!email) {
          context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Email requerido' }) };
          return;
        }
        if (!data.Nombre || !data.Nombre.trim()) {
          context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Nombre requerido' }) };
          return;
        }
        const validRoles = ['admin', 'user', 'viewer'];
        const rol = (data.Rol || 'user').toLowerCase();
        if (!validRoles.includes(rol)) {
          context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Rol inválido. Debe ser: admin, user o viewer' }) };
          return;
        }

        await upsertEntity(cfg.table, {
          partitionKey: 'usuarios',
          rowKey: email,
          Nombre: data.Nombre.trim(),
          Rol: rol
        });

        context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: { Email: email } }) };
        return;
      }

      let id = data.ID;
      if (!id) {
        const existing = await getByPartition(cfg.table, cfg.pk);
        const maxId = existing.reduce((max, e) => Math.max(max, Number(e.rowKey)), 0);
        id = maxId + 1;
      }

      const entity = { partitionKey: cfg.pk, rowKey: String(id) };

      if (resource === 'equipos') {
        if (!data.Nombre) {
          context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Nombre requerido' }) };
          return;
        }
        entity.Nombre = data.Nombre;
        entity.Descripcion = data.Descripcion || '';
        entity.Cantidad = Number(data.Cantidad) || 1;
      } else if (resource === 'bloques') {
        if (!data.HoraInicio || !data.HoraFin) {
          context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Horas requeridas' }) };
          return;
        }
        entity.HoraInicio = data.HoraInicio;
        entity.HoraFin = data.HoraFin;
        entity.Etiqueta = data.Etiqueta || `${data.HoraInicio} - ${data.HoraFin}`;
      } else if (resource === 'salas') {
        if (!data.Nombre) {
          context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Nombre requerido' }) };
          return;
        }
        entity.Nombre = data.Nombre;
        entity.Capacidad = Number(data.Capacidad) || 0;
      }

      let warning;
      if (resource === 'equipos' && data.ID) {
        const oldEntity = await getEntity(cfg.table, cfg.pk, String(data.ID));
        const oldCantidad = oldEntity ? Number(oldEntity.Cantidad) || 1 : Infinity;
        const newCantidad = Number(data.Cantidad) || 1;
        if (newCantidad < oldCantidad) {
          warning = await checkEquipmentConflicts(id, data.Nombre, newCantidad);
        }
      }

      await upsertEntity(cfg.table, entity);

      const result = { ok: true, data: { ID: id } };
      if (warning) result.warning = warning;
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
      return;
    }

    // === DELETE ===
    if (action === 'delete') {
      if (resource === 'usuarios') {
        const email = (data.Email || '').trim().toLowerCase();
        if (!email) {
          context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Email requerido' }) };
          return;
        }
        if (email === user.email) {
          context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No puedes eliminarte a ti mismo' }) };
          return;
        }
        // Check: don't delete last admin
        const targetUser = await getEntity(cfg.table, cfg.pk, email);
        if (targetUser && (targetUser.Rol || 'user') === 'admin') {
          const allUsers = await getByPartition(cfg.table, cfg.pk);
          const adminCount = allUsers.filter(u => (u.Rol || 'user') === 'admin').length;
          if (adminCount <= 1) {
            context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'No se puede eliminar el último administrador' }) };
            return;
          }
        }

        await deleteEntity(cfg.table, cfg.pk, email);
        context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
        return;
      }

      if (!data.ID) {
        context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'ID requerido' }) };
        return;
      }

      let warning;
      if (resource === 'equipos') {
        const oldEntity = await getEntity(cfg.table, cfg.pk, String(data.ID));
        if (oldEntity) {
          warning = await checkEquipmentConflicts(data.ID, oldEntity.Nombre || 'Equipo', 0);
        }
      }

      await deleteEntity(cfg.table, cfg.pk, String(data.ID));
      const result = { ok: true };
      if (warning) result.warning = warning;
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
      return;
    }

    context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Acción inválida' }) };
    return;
  } catch (err) {
    context.log.error('configManager error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
    return;
  }
};
