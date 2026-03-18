const { app } = require('@azure/functions');
const { getByPartitionRange } = require('../shared/tableClient');

app.http('getYearCompact', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'getYearCompact',
  handler: async (request, context) => {
    try {
      const year = Number(request.query.get('year'));
      if (!year) {
        return { jsonBody: { ok: false, error: 'Falta parámetro year' } };
      }

      const data = await buildYearCompact(year);
      return { jsonBody: { ok: true, data } };
    } catch (err) {
      context.error('getYearCompact error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});

async function buildYearCompact(year) {
  // Reservas are partitioned by "YYYY-MM"
  const pkStart = `${year}-01`;
  const pkEnd = `${year}-12`;
  const reservas = await getByPartitionRange('Reservas', pkStart, pkEnd);

  const firstStr = `${year}-01-01`;
  const lastStr = `${year}-12-31`;

  const yearReservations = reservas.filter(r => {
    const f = r.Fecha;
    return f >= firstStr && f <= lastStr;
  });

  // Build lookup tables
  const userMap = new Map();
  const actMap = new Map();
  const groupMap = new Map();
  const commentMap = new Map();
  const respMap = new Map();
  const users = [];
  const activities = [];
  const groups = [];
  const comments = [];
  const responsables = [];

  yearReservations.forEach(r => {
    const email = (r.Email || '').trim().toLowerCase();
    const nombre = r.Nombre || '';
    if (!userMap.has(email)) {
      userMap.set(email, users.length);
      users.push([email, nombre]);
    }

    const act = r.Actividad || '';
    if (!actMap.has(act)) {
      actMap.set(act, activities.length);
      activities.push(act);
    }

    const rec = r.Recurrencia || '';
    if (rec && !groupMap.has(rec)) {
      groupMap.set(rec, groups.length);
      groups.push(rec);
    }

    const comment = r.Comentarios || '';
    if (comment && !commentMap.has(comment)) {
      commentMap.set(comment, comments.length);
      comments.push(comment);
    }

    const resp = r.Responsable || r.Nombre || '';
    if (!respMap.has(resp)) {
      respMap.set(resp, responsables.length);
      responsables.push(resp);
    }
  });

  // Build compact records: [id, salaId, doy, bloqueId, userIdx, actIdx, groupIdx, commentIdx, equipStr, respIdx]
  const startOfYear = new Date(year, 0, 1);

  const records = yearReservations.map(r => {
    const fecha = new Date(r.Fecha + 'T00:00:00');
    const doy = Math.floor((fecha - startOfYear) / 86400000) + 1;

    const email = (r.Email || '').trim().toLowerCase();
    const act = r.Actividad || '';
    const rec = r.Recurrencia || '';
    const comment = r.Comentarios || '';
    const equip = r.Equipos || '';
    const resp = r.Responsable || r.Nombre || '';

    return [
      Number(r.rowKey),
      Number(r.SalaID),
      doy,
      Number(r.BloqueID),
      userMap.get(email),
      actMap.get(act),
      rec ? groupMap.get(rec) : -1,
      comment ? commentMap.get(comment) : -1,
      equip,
      respMap.get(resp)
    ];
  });

  return {
    y: year,
    u: users,
    a: activities,
    g: groups,
    c: comments,
    p: responsables,
    r: records
  };
}
