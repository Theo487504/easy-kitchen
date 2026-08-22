// Fügt einen Eintrag zur gemeinsamen Einkaufsliste des Haushalts hinzu.
//
// Hinweis: Diese Funktion stand nicht in der ursprünglichen Liste der "4 neuen
// Funktionen", ist aber nötig, damit die Einkaufsliste (nicht nur der Bestand)
// tatsächlich zwischen Haushaltsmitgliedern geteilt werden kann - ohne sie bliebe
// die Einkaufsliste rein lokal, obwohl die shopping-Tabelle genau dafür angelegt wurde.
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
  const label = (payload.label || '').toString().trim().slice(0, 120);

  if (!householdId || !memberId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Haushalt oder Mitglied fehlt.' }) };
  }
  if (!label) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bitte gib einen Namen für den Eintrag ein.' }) };
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

  const id = generateId();
  try {
    const result = await pool.query(
      `INSERT INTO shopping (id, household_id, label, added_by_member_id, created_at, checked)
       VALUES ($1, $2, $3, $4, NOW(), false)
       RETURNING id, created_at`,
      [id, householdId, label, memberId]
    );
    const row = result.rows[0];
    return { statusCode: 200, body: JSON.stringify({ id: row.id, created_at: row.created_at }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Eintrag konnte nicht gespeichert werden.',
        details: String((err && err.message) || err),
      }),
    };
  }
};
