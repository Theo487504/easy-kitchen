// Tritt einem bestehenden Haushalt per Code bei. Prüft, dass der Code existiert und
// dass der gewählte Name im Haushalt noch nicht vergeben ist (DB-Constraint würde das
// zwar auch verhindern, aber so bekommt die Person eine verständliche Fehlermeldung).
const { checkRateLimit } = require('../_shared/rateLimit');
const { getPool } = require('../_shared/db');
const { generateId } = require('../_shared/ids');

const DEFAULT_COLOR = '#3d5a80';

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

  const code = (payload.code || '').toString().trim().toUpperCase().slice(0, 12);
  const memberName = (payload.memberName || '').toString().trim().slice(0, 40);
  const color = (payload.color || DEFAULT_COLOR).toString().slice(0, 20);

  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bitte gib den Haushalts-Code ein.' }) };
  }
  if (!memberName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bitte gib deinen Namen ein.' }) };
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  let householdResult;
  try {
    householdResult = await pool.query('SELECT id FROM households WHERE code = $1', [code]);
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Beitritt fehlgeschlagen.', details: String((err && err.message) || err) }),
    };
  }

  if (householdResult.rows.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Kein Haushalt mit diesem Code gefunden. Bitte prüfe den Code.' }),
    };
  }
  const householdId = householdResult.rows[0].id;

  const existing = await pool.query('SELECT id FROM members WHERE household_id = $1 AND name = $2', [
    householdId,
    memberName,
  ]);
  if (existing.rows.length > 0) {
    return {
      statusCode: 409,
      body: JSON.stringify({
        error: 'Dieser Name wird in diesem Haushalt schon verwendet. Bitte wähle einen anderen Namen.',
      }),
    };
  }

  const memberId = generateId();
  try {
    await pool.query(
      'INSERT INTO members (id, household_id, name, color, joined_at) VALUES ($1, $2, $3, $4, NOW())',
      [memberId, householdId, memberName, color]
    );
  } catch (err) {
    if (err && err.code === '23505') {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'Dieser Name wird in diesem Haushalt schon verwendet.' }),
      };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Beitritt fehlgeschlagen.', details: String((err && err.message) || err) }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ householdId, memberId, code, name: memberName, color }),
  };
};
