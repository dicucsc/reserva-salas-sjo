const { TableClient, AzureNamedKeyCredential, odata } = require('@azure/data-tables');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

function getTableClient(tableName) {
  return TableClient.fromConnectionString(connectionString, tableName);
}

async function getAll(tableName) {
  const client = getTableClient(tableName);
  const entities = [];
  for await (const entity of client.listEntities()) {
    entities.push(entity);
  }
  return entities;
}

async function getByPartition(tableName, partitionKey) {
  const client = getTableClient(tableName);
  const entities = [];
  for await (const entity of client.listEntities({
    queryOptions: { filter: odata`PartitionKey eq ${partitionKey}` }
  })) {
    entities.push(entity);
  }
  return entities;
}

async function getByPartitionRange(tableName, pkStart, pkEnd) {
  const client = getTableClient(tableName);
  const entities = [];
  for await (const entity of client.listEntities({
    queryOptions: {
      filter: odata`PartitionKey ge ${pkStart} and PartitionKey le ${pkEnd}`
    }
  })) {
    entities.push(entity);
  }
  return entities;
}

async function getEntity(tableName, partitionKey, rowKey) {
  const client = getTableClient(tableName);
  try {
    return await client.getEntity(partitionKey, rowKey);
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

async function upsertEntity(tableName, entity) {
  const client = getTableClient(tableName);
  await client.upsertEntity(entity, 'Replace');
}

async function deleteEntity(tableName, partitionKey, rowKey) {
  const client = getTableClient(tableName);
  await client.deleteEntity(partitionKey, rowKey);
}

async function batchUpsert(tableName, entities) {
  const client = getTableClient(tableName);
  // Azure Table Storage batch operations must share the same PartitionKey
  // Group entities by PartitionKey
  const groups = {};
  entities.forEach(e => {
    const pk = e.partitionKey;
    if (!groups[pk]) groups[pk] = [];
    groups[pk].push(e);
  });

  for (const [pk, group] of Object.entries(groups)) {
    // Batch max is 100 operations
    for (let i = 0; i < group.length; i += 100) {
      const batch = group.slice(i, i + 100);
      const actions = batch.map(e => ['upsert', e, 'Replace']);
      await client.submitTransaction(actions);
    }
  }
}

async function batchDelete(tableName, keys) {
  const client = getTableClient(tableName);
  // Group by PartitionKey
  const groups = {};
  keys.forEach(k => {
    if (!groups[k.partitionKey]) groups[k.partitionKey] = [];
    groups[k.partitionKey].push(k);
  });

  for (const [pk, group] of Object.entries(groups)) {
    for (let i = 0; i < group.length; i += 100) {
      const batch = group.slice(i, i + 100);
      const actions = batch.map(k => ['delete', { partitionKey: k.partitionKey, rowKey: k.rowKey }]);
      await client.submitTransaction(actions);
    }
  }
}

module.exports = {
  getTableClient,
  getAll,
  getByPartition,
  getByPartitionRange,
  getEntity,
  upsertEntity,
  deleteEntity,
  batchUpsert,
  batchDelete
};
