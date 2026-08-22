// Entfernt ein anderes Mitglied aus dem Haushalt. Nur die gründende Person
// (households.created_by_member_id) darf das - jede andere Anfrage wird mit
// 403 abgelehnt. Zum Verlassen des eigenen Mitgliedschafts nutzt die App
// stattdessen /api/household/leave.
const { checkRateLimit } = require('../_shared/rateLimit');
const { getPool } = require('../_shared/db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const limited = checkRateLimit(event, { limit: 20, windowMs: 60000 });
  if (limited) return limited;

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Anfrage' }) };
  }

  const householdId = (payload.householdId || '').toString();
  const requestingMemberId = (payload.memberId || '').toString();
  const targetMemberId = (payload.targetMemberId || '').toString();

  if (!householdId || !requestingMemberId || !targetMemberId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Angaben fehlen.' }) };
  }
  if (requestingMemberId === targetMemberId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Zum Verlassen bitte "Haushalt verlassen" nutzen.' }),
    };
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  const householdResult = await pool.query(
    'SELECT id, created_by_member_id FROM households WHERE id = $1',
    [householdId]
  );
  if (householdResult.rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Haushalt nicht gefunden.' }) };
  }
  const household = householdResult.rows[0];

  if (household.created_by_member_id !== requestingMemberId) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        error: 'Nur die Person, die den Haushalt gegründet hat, kann Mitglieder entfernen.',
      }),
    };
  }

  try {
    const result = await pool.query('DELETE FROM members WHERE id = $1 AND household_id = $2', [
      targetMemberId,
      householdId,
    ]);
    if (result.rowCount === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Mitglied nicht gefunden.' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Entfernen fehlgeschlagen.',
        details: String((err && err.message) || err),
      }),
    };
  }
};
