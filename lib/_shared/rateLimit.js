// Einfacher Schutz der öffentlich erreichbaren KI-Funktionen gegen Missbrauch:
// begrenzt die Anzahl Anfragen pro IP-Adresse und Minute (Standard: 8/Minute).
//
// Ehrliche Einordnung der Grenzen dieses Ansatzes: Der Zähler lebt im Arbeitsspeicher
// der jeweiligen Function-Instanz. Netlify hält warme Instanzen zwischen Aufrufen am
// Leben, d.h. für den typischen Fall (jemand hämmert schnell hintereinander auf die
// Funktion ein oder ein Skript ruft sie in Schleife auf) greift das Limit zuverlässig.
// Bei einem Kaltstart oder mehreren parallelen Instanzen beginnt der Zähler jedoch neu -
// ein entschlossener Angreifer wird also nur gebremst, nicht vollständig gestoppt.
// Für "App mit Familie und Freunden teilen" ist das der richtige, einfache Schutz;
// für einen öffentlichen Launch bräuchte es einen echten Speicher (z.B. Upstash/Blobs).

const buckets = new Map();

function clientIp(event) {
  const h = (event && event.headers) || {};
  // Jeder Hoster nennt die Besucher-IP anders: die ersten beiden sind Netlify,
  // x-real-ip und x-forwarded-for liefert Vercel. x-forwarded-for kann eine Kette
  // sein ("client, proxy1, proxy2") - dann zaehlt der erste Eintrag.
  const forwarded = h['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  return h['x-nf-client-connection-ip'] || h['client-ip'] || h['x-real-ip'] || first || 'unbekannt';
}

// Gibt null zurück, wenn die Anfrage erlaubt ist - sonst direkt die fertige
// 429-Antwort, die der Handler unverändert zurückgeben kann.
function checkRateLimit(event, { limit = 8, windowMs = 60000 } = {}) {
  const ip = clientIp(event);
  const now = Date.now();
  const recent = (buckets.get(ip) || []).filter((t) => now - t < windowMs);

  if (recent.length >= limit) {
    buckets.set(ip, recent);
    return {
      statusCode: 429,
      body: JSON.stringify({
        error: 'Kurz durchatmen 😊 Es sind gerade sehr viele Anfragen auf einmal. Bitte warte einen Moment und versuch es dann nochmal.',
      }),
    };
  }

  recent.push(now);
  buckets.set(ip, recent);

  // Speicher aufräumen, damit die Map bei vielen verschiedenen IPs nicht ewig wächst.
  if (buckets.size > 500) {
    for (const [key, times] of buckets) {
      if (times.every((t) => now - t > windowMs)) buckets.delete(key);
    }
  }
  return null;
}

module.exports = { checkRateLimit };
