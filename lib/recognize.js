// Netlify Function: nimmt ein Foto entgegen, schickt es an die Google Gemini API
// zur Bilderkennung und gibt eine einfache Liste erkannter Lebensmittel zurück.
//
// Benötigt die Umgebungsvariable GEMINI_API_KEY (in den Netlify-Projekteinstellungen
// unter "Environment variables" hinterlegt, NIE im Code).
// Optional: GEMINI_MODEL, um das Modell zu wechseln (Standard: gemini-flash-latest).

const { fetchWithRetry } = require('./_shared/geminiFetch');
const { checkRateLimit } = require('./_shared/rateLimit');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const limited = checkRateLimit(event);
  if (limited) return limited;

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Anfrage' }) };
  }

  const { imageBase64, mimeType, type } = payload;
  if (!imageBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Kein Bild erhalten' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server ist noch nicht eingerichtet: GEMINI_API_KEY fehlt in den Umgebungsvariablen des Hosters.' }),
    };
  }

  // "gemini-flash-latest" ist ein von Google gepflegter Alias, der automatisch
  // auf das jeweils aktuelle Flash-Modell zeigt - so bricht die Funktion nicht
  // wieder, wenn Google ein Modell abschaltet (wie bei gemini-2.5-flash geschehen).
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  const prompt = `Du bekommst ein Foto von einem Bereich zuhause (Kassenzettel, Kühlschrank oder ein sonstiger Aufbewahrungsort wie Schrank, Regal oder Schublade; Kontext: "${type || 'unbekannt'}").

Erkenne alle Lebensmittel/Zutaten, die auf dem Foto zu sehen sind.

Wichtig bei Kassenzetteln (deutsche Supermarkt-Kassenbons): Produktnamen sind dort oft stark abgekürzt oder abgeschnitten, z.B. "Fettar.Milch" = "Fettarme Milch", "Kulturheidelb." = "Kulturheidelbeeren", "Haferflock." = "Haferflocken", "Joghurt grie." = "Griechischer Joghurt", "Bio Al." = "Bio Alpen...". Löse solche Abkürzungen zu natürlichen, vollständigen deutschen Produktnamen auf - sei dabei ruhig etwas großzügig und nutze dein Wissen über typische Supermarktprodukte, statt bei Unsicherheit nichts auszugeben.
Ignoriere dabei Zeilen, die keine Produkte sind: Preise, "SUMME"/Gesamtbetrag, "Pfand", Rabatte, Bonpunkte, Kassierer-/Datumszeilen.

Schätze außerdem für jedes Produkt realistisch, wie viele Tage es ab heute normalerweise noch haltbar/gut ist (ungeöffnet, wie im Supermarkt üblich gelagert). Richte dich dabei an typischen deutschen Supermarktprodukten, zum Beispiel:
- Frische Molkereiprodukte (Milch, Joghurt, Quark, frischer Käse): 5-10 Tage
- Frisches Obst/Gemüse: 3-9 Tage (Beeren/Salat kürzer, Wurzelgemüse/Zwiebeln länger)
- Frisches Fleisch/Fisch: 2-5 Tage
- Brot/Backwaren: 3-6 Tage
- Eier: 14-21 Tage
- Trockenware (Nudeln, Reis, Mehl, Hülsenfrüchte, Müsli, Haferflocken): 180-365 Tage
- Konserven/Dosen/Gläser (auch geschlossen): 365-720 Tage
- Getränke in Flasche/Dose, ungeöffnet (Wasser, Limonade, Cola/Pepsi, Saft): 180-365 Tage
- Snacks, Nüsse/Nussmischungen, Chips (ungeöffnet): 120-270 Tage
Bei Unsicherheit lieber eine vorsichtige, aber plausible mittlere Schätzung (z.B. 14) statt keine Angabe.

Antworte AUSSCHLIESSLICH mit einem JSON-Array aus Objekten mit den Feldern "name" (kurzer, natürlichsprachiger deutscher Produktname) und "estDays" (Ganzzahl, geschätzte Tage ab heute haltbar), zum Beispiel:
[{"name":"Fettarme Milch","estDays":7},{"name":"Kulturheidelbeeren","estDays":5},{"name":"Haferflocken","estDays":270}]
Erfinde keine Produkte, die nicht im Bild vorkommen - aber löse erkennbare Abkürzungen sinnvoll auf, statt sie wegzulassen.
Wenn auf dem Foto wirklich gar nichts zu erkennen ist, gib ein leeres Array [] zurück.
Antworte NUR mit dem JSON-Array, ohne weitere Erklärung und ohne Markdown-Codeblock.`;

  try {
    const resp = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            // Erzwingt sauberes JSON direkt vom Modell, statt auf Freitext + Regex-Extraktion
            // zu hoffen. Das verhindert leere Ergebnisse durch abgeschnittene/verunstaltete
            // Antworten (z.B. wenn das Modell vor dem JSON noch einen Satz Erklärung schreibt).
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  estDays: { type: 'INTEGER' },
                },
                required: ['name', 'estDays'],
              },
            },
          },
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      const friendly = resp.status === 503
        ? 'Die KI ist gerade überlastet (Google-Server, kurzfristig). Bitte in ein paar Sekunden nochmal versuchen.'
        : 'KI-Anfrage fehlgeschlagen';
      return {
        statusCode: 502,
        body: JSON.stringify({ error: friendly, details: `HTTP ${resp.status} (Modell: ${model}): ${errText.slice(0, 400)}` }),
      };
    }

    const data = await resp.json();
    const candidate = data && data.candidates && data.candidates[0];
    const text = candidate && candidate.content &&
      candidate.content.parts && candidate.content.parts[0] &&
      candidate.content.parts[0].text;
    const finishReason = candidate && candidate.finishReason;

    let items = [];
    if (text) {
      // Dank responseMimeType/responseSchema sollte "text" bereits reines JSON sein.
      // Trotzdem sicherheitshalber mit Regex-Fallback abfangen, falls das Modell doch
      // mal Markdown-Codeblock o.ä. drumherum schreibt.
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) items = parsed;
      } catch (e) {
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed)) items = parsed;
          } catch (e2) {
            items = [];
          }
        }
      }
    }

    items = items
      .filter((i) => i && typeof i === 'object' && typeof i.name === 'string' && i.name.trim().length > 0)
      .map((i) => {
        const n = Number(i.estDays);
        // Sicherheitsnetz: falls die KI eine unrealistische Zahl liefert, auf 1-730 Tage begrenzen.
        const estDays = Number.isFinite(n) ? Math.max(1, Math.min(730, Math.round(n))) : 14;
        return { name: i.name.trim(), estDays };
      })
      .slice(0, 12);

    // Debug-Info: falls trotz allem nichts erkannt wurde, geben wir mit, warum die
    // KI-Antwort zu Ende ging (z.B. "MAX_TOKENS" würde auf ein Token-Limit-Problem
    // hindeuten) - hilfreich, falls das Problem nochmal auftaucht.
    const responseBody = { items };
    if (items.length === 0) {
      responseBody.debug = { finishReason: finishReason || null, hadText: Boolean(text) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responseBody),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unerwarteter Fehler bei der KI-Anfrage', details: String(err) }),
    };
  }
};
