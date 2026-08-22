// Markiert einen Eintrag der gemeinsamen Einkaufsliste als erledigt (gekauft).
// Gehört wie shopping/add.js zur Ergänzung, damit die Einkaufsliste wirklich in
// beide Richtungen synchron bleibt (siehe Kommentar dort).
const { checkRateLimit } = require('../_shared/rateLimit');
const { getPool } = require('../_shared/db');

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
  const id = (payload.id || '').toString();
  const checked = payload.checked !== false; // Standard: als erledigt markieren

  if (!householdId || !memberId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Haushalt oder Mitglied fehlt.' }) };
  }
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Kein Eintrag angegeben.' }) };
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  const memberCheck = await pool.query('SELECT id FROM members WHERE id = $1 AND household_id = $2', [
    memberId,
    householdId,
  ]);
  if (memberCheck.rows.length === 0) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Kein Zugriff auf diesen Haushalt.' }) };
  }

  try {
    const result = await pool.query('UPDATE shopping SET checked = $1 WHERE id = $2 AND household_id = $3', [
      checked,
      id,
      householdId,
    ]);
    if (result.rowCount === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Eintrag nicht gefunden.' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Konnte nicht aktualisiert werden.', details: String((err && err.message) || err) }),
    };
  }
};
