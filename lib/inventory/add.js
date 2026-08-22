// Fügt einen Artikel zum gemeinsamen Bestand eines Haushalts hinzu.
const { checkRateLimit } = require('../_shared/rateLimit');
const { getPool } = require('../_shared/db');
const { generateId } = require('../_shared/ids');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const limited = checkRateLimit(event, { limit: 60, windowMs: 60000 });
  if (limited) return limited;

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Anfrage' }) };
  }

  const householdId = (payload.householdId || '').toString();
  const memberId = (payload.memberId || '').toString();
  const name = (payload.name || '').toString().trim().slice(0, 120);
  const category = (payload.category || '').toString().trim().slice(0, 60) || null;
  const exact = payload.exact === true;
  let expiry = null;
  if (payload.expiry) {
    const d = new Date(payload.expiry);
    if (Number.isNaN(d.getTime())) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Ungültiges Ablaufdatum.' }) };
    }
    expiry = d;
  }

  if (!householdId || !memberId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Haushalt oder Mitglied fehlt.' }) };
  }
  if (!name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bitte gib einen Namen für den Artikel ein.' }) };
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  // Sicherheit: das Mitglied muss wirklich zu diesem Haushalt gehören, sonst könnte
  // jeder mit einer erratenen householdId fremden Beständen Artikel unterschieben.
  const memberCheck = await pool.query('SELECT id FROM members WHERE id = $1 AND household_id = $2', [
    memberId,
    householdId,
  ]);
  if (memberCheck.rows.length === 0) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Kein Zugriff auf diesen Haushalt.' }) };
  }

  const id = generateId();
  try {
    const result = await pool.query(
      `INSERT INTO inventory (id, household_id, name, category, expiry, exact, added_by_member_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, created_at, updated_at`,
      [id, householdId, name, category, expiry, exact, memberId]
    );
    const row = result.rows[0];
    return {
      statusCode: 200,
      body: JSON.stringify({ id: row.id, created_at: row.created_at, updated_at: row.updated_at }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Artikel konnte nicht gespeichert werden.',
        details: String((err && err.message) || err),
      }),
    };
  }
};
