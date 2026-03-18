const { app } = require('@azure/functions');
const { getByPartition } = require('../shared/tableClient');

app.http('fullInit', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'fullInit',
  handler: async (request, context) => {
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

      return { jsonBody: { ok: true, data: { salas, bloques, equipos } } };
    } catch (err) {
      context.error('fullInit error:', err);
      return { status: 500, jsonBody: { ok: false, error: err.message } };
    }
  }
});
