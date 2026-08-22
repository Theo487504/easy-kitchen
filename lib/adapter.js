// Übersetzt zwischen Vercel und unseren bestehenden Funktionen.
//
// Der eigentliche Code der drei KI-Funktionen liegt unverändert in diesem Ordner und
// ist im Netlify-Stil geschrieben (bekommt ein "event", gibt {statusCode, body}
// zurück). Vercel arbeitet dagegen mit (req, res). Statt alles doppelt zu pflegen -
// was garantiert irgendwann auseinanderläuft - gibt es hier eine dünne Übersetzungs-
// schicht. So bleibt EINE Version der Logik für beide Hoster.

function toVercel(netlifyHandler) {
  return async function handler(req, res) {
    try {
      // Vercel parst JSON-Bodies selbst, unsere Funktionen erwarten aber Text.
      let bodyText = '';
      if (typeof req.body === 'string') bodyText = req.body;
      else if (req.body) bodyText = JSON.stringify(req.body);

      const result = await netlifyHandler({
        httpMethod: req.method,
        body: bodyText,
        headers: req.headers || {},
        // Für GET-Endpunkte mit Query-Parametern (z.B. /api/sync?householdId=...).
        // Vercel füllt req.query bei Node-Functions automatisch aus der URL.
        queryStringParameters: req.query || {},
      });

      const headers = result.headers || {};
      Object.keys(headers).forEach((k) => res.setHeader(k, headers[k]));
      if (!headers['Content-Type'] && !headers['content-type']) {
        res.setHeader('Content-Type', 'application/json');
      }
      res.status(result.statusCode || 200).send(result.body || '');
    } catch (err) {
      res.status(500).json({
        error: 'Unerwarteter Fehler auf dem Server',
        details: String((err && err.message) || err),
      });
    }
  };
}

module.exports = { toVercel };
