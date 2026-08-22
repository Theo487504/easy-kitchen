// Erstellt einen neuen Haushalt mit zufälligem, eindeutigem Code. Die anlegende
// Person wird automatisch das erste Mitglied.
const { checkRateLimit } = require('../_shared/rateLimit');
const { getPool } = require('../_shared/db');
const { generateId, generateCode } = require('../_shared/ids');

const DEFAULT_COLOR = '#e07a5f';
const MAX_CODE_ATTEMPTS = 5;

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

  const memberName = (payload.memberName || '').toString().trim().slice(0, 40);
  const color = (payload.color || DEFAULT_COLOR).toString().slice(0, 20);

  if (!memberName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bitte gib deinen Namen ein.' }) };
  }

  let pool;
  try {
    pool = getPool();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  const householdId = generateId();
  const memberId = generateId();

  // Der Code muss eindeutig sein - im (sehr unwahrscheinlichen) Kollisionsfall wird
  // einfach ein neuer gezogen, statt der Person einen Serverfehler zu zeigen.
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    try {
      await pool.query(
        'INSERT INTO households (id, code, created_at, created_by_member_id) VALUES ($1, $2, NOW(), $3)',
        [householdId, code, memberId]
      );
      await pool.query(
        'INSERT INTO members (id, household_id, name, color, joined_at) VALUES ($1, $2, $3, $4, NOW())',
        [memberId, householdId, memberName, color]
      );
      return {
        statusCode: 200,
        body: JSON.stringify({ householdId, memberId, code, name: memberName, color }),
      };
    } catch (err) {
      if (err && err.code === '23505') continue; // Code-Kollision - nochmal versuchen
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Haushalt konnte nicht erstellt werden.',
          details: String((err && err.message) || err),
        }),
      };
    }
  }

  return {
    statusCode: 500,
    body: JSON.stringify({ error: 'Konnte keinen eindeutigen Code erzeugen. Bitte nochmal versuchen.' }),
  };
};
