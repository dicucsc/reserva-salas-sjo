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
      return { status: 400, body: { ok: false, error: 'Recurso inválido' } };
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
      return { body: { ok: true, data: items } };
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
        if (!data.Nombre) return { status: 400, body: { ok: false, error: 'Nombre requerido' } };
        entity.Nombre = data.Nombre;
        entity.Descripcion = data.Descripcion || '';
        entity.Cantidad = Number(data.Cantidad) || 1;
      } else if (resource === 'bloques') {
        if (!data.HoraInicio || !data.HoraFin) return { status: 400, body: { ok: false, error: 'Horas requeridas' } };
        entity.HoraInicio = data.HoraInicio;
        entity.HoraFin = data.HoraFin;
        entity.Etiqueta = data.Etiqueta || `${data.HoraInicio} - ${data.HoraFin}`;
      } else if (resource === 'salas') {
        if (!data.Nombre) return { status: 400, body: { ok: false, error: 'Nombre requerido' } };
        entity.Nombre = data.Nombre;
        entity.Capacidad = Number(data.Capacidad) || 0;
      }

      await upsertEntity(cfg.table, entity);
      return { body: { ok: true, data: { ID: id } } };
    }

    if (action === 'delete') {
      if (!data.ID) return { status: 400, body: { ok: false, error: 'ID requerido' } };
      await deleteEntity(cfg.table, cfg.pk, String(data.ID));
      return { body: { ok: true } };
    }

    return { status: 400, body: { ok: false, error: 'Acción inválida' } };
  } catch (err) {
    context.log.error('adminConfig error:', err);
    return { status: 500, body: { ok: false, error: err.message } };
  }
};
