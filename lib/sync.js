// Liefert den aktuellen Bestand + Einkaufsliste + Mitgliederliste eines Haushalts.
//
// Delta-Sync (per "since") gibt es nur für den Bestand, weil die inventory-Tabelle
// eine updated_at-Spalte hat. Die shopping-Tabelle hat laut Schema keine updated_at-
// Spalte (nur created_at + checked) - ein "seit wann geändert" lässt sich für abgehakte
// Einträge also nicht sauber bestimmen. Deshalb wird die Einkaufsliste bei jedem Sync
// immer komplett (aber nur die noch offenen Einträge) zurückgegeben; die Liste ist in
// der Praxis klein, das fällt nicht ins Gewicht.
const { getPool } = require('./_shared/db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const query = event.queryStringParameters || {};
  const householdId = (query.householdId || '').toString();
  const sinceRaw = query.since;

  if (!householdId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'householdId fehlt.' }) };
  }

  let since = null;
  if (sinceRaw !== undefined && sinceRaw !== null && sinceRaw !== '' && sinceRaw !== '0') {
    const n = Number(sinceRaw);
    if (!Number.isFinite(n)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Ungültiger since-Wert.' }) };
    }
    since = new Date(n);
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  const householdCheck = await pool.query('SELECT id FROM households WHERE id = $1', [householdId]);
  if (householdCheck.rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Haushalt nicht gefunden.' }) };
  }

  try {
    const [inventoryResult, shoppingResult, membersResult] = await Promise.all([
      since
        ? pool.query(
            'SELECT * FROM inventory WHERE household_id = $1 AND updated_at > $2 ORDER BY updated_at ASC',
            [householdId, since]
          )
        : pool.query('SELECT * FROM inventory WHERE household_id = $1 ORDER BY updated_at ASC', [householdId]),
      pool.query(
        'SELECT * FROM shopping WHERE household_id = $1 AND checked = false ORDER BY created_at ASC',
        [householdId]
      ),
      pool.query('SELECT id, name, color, joined_at FROM members WHERE household_id = $1 ORDER BY joined_at ASC', [
        householdId,
      ]),
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        inventory: inventoryResult.rows,
        shopping: shoppingResult.rows,
        members: membersResult.rows,
        timestamp: Date.now(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Sync fehlgeschlagen.', details: String((err && err.message) || err) }),
    };
  }
};
