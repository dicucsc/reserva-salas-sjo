const { getByPartition, upsertEntity, deleteEntity } = require('../shared/tableClient');

const TABLES = {
  equipos: { table: 'Equipos', pk: 'equipos' },
  bloques: { table: 'Bloques', pk: 'bloques' },
  salas:   { table: 'Salas',   pk: 'salas' }
};

module.exports = async function (context, req) {
  try {
    const { resource, action, data } = req.body;

    const cfg = TABLES[resource];
    if (!cfg) {
      context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Recurso inválido' }) };
      return;
    }

    if (action === 'list') {
      const raw = await getByPartition(cfg.table, cfg.pk);
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

    if (action === 'save') {
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

      await upsertEntity(cfg.table, entity);
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: { ID: id } }) };
      return;
    }

    if (action === 'delete') {
      if (!data.ID) {
        context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'ID requerido' }) };
        return;
      }
      await deleteEntity(cfg.table, cfg.pk, String(data.ID));
      context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
      return;
    }

    context.res = { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Acción inválida' }) };
    return;
  } catch (err) {
    context.log.error('adminConfig error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
    return;
  }
};
