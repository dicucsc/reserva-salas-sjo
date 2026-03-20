module.exports = async function (context, req) {
  const diag = {
    ok: true,
    msg: 'API running',
    node: process.version,
    hasConnectionString: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
    connectionStringLength: (process.env.AZURE_STORAGE_CONNECTION_STRING || '').length
  };

  // Test Table Storage connection if requested
  if (req.query.deep === 'true') {
    try {
      const { getAll } = require('../shared/tableClient');
      const salas = await getAll('Salas');
      diag.tableStorage = { ok: true, salasCount: salas.length };
    } catch (err) {
      diag.tableStorage = { ok: false, error: err.message };
    }
  }

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diag)
  };
};
