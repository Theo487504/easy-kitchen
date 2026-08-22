// Netlify Function: nimmt eine Rezeptidee (Freitext) + den aktuellen Bestand entgegen
// und lässt Google Gemini daraus ein konkretes, umsetzbares Rezept erstellen -
// bevorzugt mit den vorhandenen Zutaten, sonst leicht abgewandelt.
//
// Benötigt die Umgebungsvariable GEMINI_API_KEY (bei Netlify wie bei Vercel in den
// Projekt-Einstellungen unter "Environment variables" hinterlegen, NIE im Code).

const { fetchWithRetry } = require('./_shared/geminiFetch');
const { personalizationPromptBlock } = require('./_shared/personalization');
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

  const idea = (payload.idea || '').toString().trim();
  const inventory = Array.isArray(payload.inventory) ? payload.inventory.filter((i) => typeof i === 'string') : [];
  if (!idea) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Keine Rezeptidee erhalten' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server ist noch nicht eingerichtet: GEMINI_API_KEY fehlt in den Umgebungsvariablen des Hosters.' }),
    };
  }

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  // Bewusst KEINE fest eingebaute Ernährungs-Ausrichtung (z.B. vegan/proteinreich) mehr -
  // das war früher hier hardcodiert, obwohl das nur Theos persönliche Vorliebe war. Stattdessen
  // kommt das jetzt (falls vorhanden) aus der echten Personalisierung, die die Person selbst
  // in der App ausgefüllt hat.
  const personalizationBlock = personalizationPromptBlock(payload.personalization);

  const prompt = `Du bist ein Koch-Assistent in einer App, die Leuten hilft, mit dem zu kochen, was sie zuhause haben.

Die Person hat gerade Lust auf: "${idea}"${personalizationBlock}

Das ist aktuell zuhause vorhanden (Kühlschrank + Vorrat):
${inventory.length ? inventory.map((n) => `- ${n}`).join('\n') : '(nichts erfasst)'}

Erstelle EIN konkretes, umsetzbares Rezept, das der Idee der Person möglichst nah kommt. Nutze dabei so viele der vorhandenen Zutaten wie sinnvoll möglich - wenn die Idee nicht 1:1 mit dem Bestand umsetzbar ist, wandle sie kreativ leicht ab (z.B. andere Gemüsesorte, anderes Protein), statt einfach nur fehlende Standardzutaten aufzulisten. Richte dich dabei ausschließlich nach dem, was die Person tatsächlich möchte - erfinde keine zusätzlichen Ernährungsvorgaben (z.B. vegan, proteinreich) hinzu, außer die Person hat das selbst so angegeben.

WICHTIG - das Rezept soll ein RICHTIGES, ausführliches Rezept sein, kein Dreizeiler:
- "steps": 5 bis 9 Zubereitungsschritte, jeder Schritt 1-3 vollständige Sätze mit konkreten Angaben zu Hitze, Dauer und woran man erkennt, dass der Schritt gelungen ist (z.B. "goldbraun", "die Sauce dickt leicht an"). Insgesamt etwa 100-200 Wörter, je nach Aufwand des Gerichts.
- "ingredientsHave" und "ingredientsMissing": jede Zutat MIT Mengenangabe für 2 Portionen, z.B. "200 g rote Linsen" oder "1 EL Sojasauce". Bei ingredientsHave den Zutaten-Namen aus dem Bestand oben erkennbar lassen (Menge davor ist okay).
- "tip": ein kurzer, hilfreicher Extra-Tipp zum Rezept (1-2 Sätze).
- "portions": für wie viele Portionen die Mengen gelten (normalerweise 2).
- "summary": eine EIN-Satz-Kurzfassung der Zubereitung für die Übersicht (max. 25 Wörter), z.B. "Zwiebeln anrösten, Linsen in Kokosmilch köcheln, Spinat unterheben - cremiges Curry in einem Topf."

Antworte AUSSCHLIESSLICH als JSON-Objekt mit genau diesen Feldern:
{
  "name": "kurzer, appetitlicher deutscher Rezeptname",
  "tags": ["z.B. Vegan, Vegetarisch, Proteinreich, Schnell - passende Stichworte"],
  "time": <Zubereitungszeit in Minuten, Ganzzahl>,
  "kcal": <geschätzte Kalorien pro Portion, Ganzzahl>,
  "protein": <geschätztes Protein in Gramm pro Portion, Ganzzahl>,
  "portions": <Ganzzahl, meist 2>,
  "ingredientsHave": ["Zutaten mit Menge, die bereits im Bestand oben vorhanden sind"],
  "ingredientsMissing": ["zusätzliche Zutaten mit Menge, die noch gekauft werden müssten"],
  "steps": ["ausführliche Zubereitungsschritte auf Deutsch, siehe oben"],
  "tip": "<kurzer Extra-Tipp>",
  "summary": "<Ein-Satz-Kurzfassung der Zubereitung>"
}
Antworte NUR mit dem JSON-Objekt, ohne weitere Erklärung und ohne Markdown-Codeblock.`;

  try {
    const resp = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.6,
            // Muss groß genug sein, damit das komplette JSON-Objekt (Name, Tags, Zutaten,
            // mehrere AUSFÜHRLICHE Zubereitungsschritte) nicht mittendrin abgeschnitten
            // wird - ein zu knappes Budget führte dazu, dass die Antwort kein gültiges
            // JSON mehr war. Seit die Rezepte ausführlich sind, nochmal erhöht.
            maxOutputTokens: 3072,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                tags: { type: 'ARRAY', items: { type: 'STRING' } },
                time: { type: 'INTEGER' },
                kcal: { type: 'INTEGER' },
                protein: { type: 'INTEGER' },
                portions: { type: 'INTEGER' },
                ingredientsHave: { type: 'ARRAY', items: { type: 'STRING' } },
                ingredientsMissing: { type: 'ARRAY', items: { type: 'STRING' } },
                steps: { type: 'ARRAY', items: { type: 'STRING' } },
                tip: { type: 'STRING' },
                summary: { type: 'STRING' },
              },
              required: ['name', 'tags', 'time', 'kcal', 'protein', 'portions', 'ingredientsHave', 'ingredientsMissing', 'steps', 'tip', 'summary'],
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

    let recipe = null;
    if (text) {
      try {
        recipe = JSON.parse(text);
      } catch (e) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try { recipe = JSON.parse(match[0]); } catch (e2) { recipe = null; }
        }
      }
    }

    if (!recipe || typeof recipe.name !== 'string') {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Die KI konnte kein Rezept erstellen. Versuch es mit einer anderen Formulierung.',
          details: `finishReason=${finishReason || 'unbekannt'}, hadText=${Boolean(text)}, textPreview="${String(text || '').slice(0, 200)}"`,
        }),
      };
    }

    const clean = {
      name: String(recipe.name).trim().slice(0, 80),
      tags: Array.isArray(recipe.tags) ? recipe.tags.filter((t) => typeof t === 'string').slice(0, 6) : [],
      time: Number.isFinite(Number(recipe.time)) ? Math.max(1, Math.round(Number(recipe.time))) : 30,
      kcal: Number.isFinite(Number(recipe.kcal)) ? Math.max(0, Math.round(Number(recipe.kcal))) : 0,
      protein: Number.isFinite(Number(recipe.protein)) ? Math.max(0, Math.round(Number(recipe.protein))) : 0,
      portions: Number.isFinite(Number(recipe.portions)) ? Math.max(1, Math.min(12, Math.round(Number(recipe.portions)))) : 2,
      ingredientsHave: Array.isArray(recipe.ingredientsHave) ? recipe.ingredientsHave.filter((i) => typeof i === 'string').slice(0, 20) : [],
      ingredientsMissing: Array.isArray(recipe.ingredientsMissing) ? recipe.ingredientsMissing.filter((i) => typeof i === 'string').slice(0, 20) : [],
      steps: Array.isArray(recipe.steps) ? recipe.steps.filter((s) => typeof s === 'string').slice(0, 12) : [],
      tip: typeof recipe.tip === 'string' ? recipe.tip.trim().slice(0, 300) : '',
      summary: typeof recipe.summary === 'string' ? recipe.summary.trim().slice(0, 220) : '',
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe: clean }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unerwarteter Fehler bei der KI-Anfrage', details: String(err) }),
    };
  }
};
