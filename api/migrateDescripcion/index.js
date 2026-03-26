const { getAuthenticatedUser } = require('../shared/auth');
const { getByPartition, upsertEntity } = require('../shared/tableClient');

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

    const dryRun = req.body?.dryRun !== false; // default true

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const partitions = [];
    for (let m = 1; m <= currentMonth; m++) {
      partitions.push(`2026-${String(m).padStart(2, '0')}`);
    }

    let total = 0;
    let migrated = 0;
    const partitionResults = [];

    for (const pk of partitions) {
      const entities = await getByPartition('Reservas', pk);
      const candidates = entities.filter(e => {
        const comment = e.Comentarios || '';
        const desc = e.Descripcion || '';
        return comment.length > 0 && desc.length === 0;
      });

      partitionResults.push({ partition: pk, total: entities.length, candidates: candidates.length });
      total += entities.length;

      if (!dryRun && candidates.length > 0) {
        for (const entity of candidates) {
          entity.Descripcion = entity.Comentarios;
          entity.Comentarios = '';
          await upsertEntity('Reservas', entity);
          migrated++;
        }
      } else {
        migrated += candidates.length;
      }
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, dryRun, total, migrated, partitions: partitionResults })
    };
  } catch (err) {
    context.log.error('migrateDescripcion error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
