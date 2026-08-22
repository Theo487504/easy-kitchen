// Lässt ein Mitglied den Haushalt verlassen. Ist die Person die einzige im
// Haushalt, wird der ganze Haushalt (inkl. Bestand & Einkaufsliste) aufgelöst.
// Ist sie die gründende Person und es gibt noch andere Mitglieder, geht die
// Verwaltung an das am längsten dabei seiende verbleibende Mitglied über -
// so bleibt der Haushalt für alle anderen ohne Unterbrechung nutzbar.
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
  const memberId = (payload.memberId || '').toString();

  if (!householdId || !memberId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Haushalt oder Mitglied fehlt.' }) };
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

  const memberCheck = await pool.query('SELECT id FROM members WHERE id = $1 AND household_id = $2', [
    memberId,
    householdId,
  ]);
  if (memberCheck.rows.length === 0) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Kein Zugriff auf diesen Haushalt.' }) };
  }

  try {
    const othersResult = await pool.query(
      'SELECT id FROM members WHERE household_id = $1 AND id != $2 ORDER BY joined_at ASC',
      [householdId, memberId]
    );
    const others = othersResult.rows;

    if (others.length === 0) {
      // Letzte Person verlässt den Haushalt -> Haushalt komplett auflösen.
      await pool.query('DELETE FROM inventory WHERE household_id = $1', [householdId]);
      await pool.query('DELETE FROM shopping WHERE household_id = $1', [householdId]);
      await pool.query('DELETE FROM members WHERE household_id = $1', [householdId]);
      await pool.query('DELETE FROM households WHERE id = $1', [householdId]);
      return { statusCode: 200, body: JSON.stringify({ ok: true, householdDissolved: true }) };
    }

    if (household.created_by_member_id === memberId) {
      const newAdminId = others[0].id;
      await pool.query('UPDATE households SET created_by_member_id = $1 WHERE id = $2', [
        newAdminId,
        householdId,
      ]);
    }

    await pool.query('DELETE FROM members WHERE id = $1', [memberId]);
    return { statusCode: 200, body: JSON.stringify({ ok: true, householdDissolved: false }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Verlassen fehlgeschlagen.',
        details: String((err && err.message) || err),
      }),
    };
  }
};
