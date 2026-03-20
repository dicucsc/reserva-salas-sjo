const { getByPartition } = require('../shared/tableClient');

module.exports = async function (context, req) {
  try {
    const [salasRaw, bloquesRaw, equiposRaw] = await Promise.all([
      getByPartition('Salas', 'salas'),
      getByPartition('Bloques', 'bloques'),
      getByPartition('Equipos', 'equipos')
    ]);

    const salas = salasRaw.map(s => ({
      ID: Number(s.rowKey),
      Nombre: s.Nombre,
      Capacidad: Number(s.Capacidad)
    })).sort((a, b) => a.ID - b.ID);

    const bloques = bloquesRaw.map(b => ({
      ID: Number(b.rowKey),
      HoraInicio: b.HoraInicio,
      HoraFin: b.HoraFin,
      Etiqueta: b.Etiqueta || `${b.HoraInicio} - ${b.HoraFin}`
    })).sort((a, b) => a.ID - b.ID);

    const equipos = equiposRaw.map(e => ({
      ID: Number(e.rowKey),
      Nombre: e.Nombre,
      Descripcion: e.Descripcion || '',
      Cantidad: Number(e.Cantidad)
    })).sort((a, b) => a.ID - b.ID);

    context.res = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: { salas, bloques, equipos } }) };
    return;
  } catch (err) {
    context.log.error('fullInit error:', err);
    context.res = { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
    return;
  }
};
