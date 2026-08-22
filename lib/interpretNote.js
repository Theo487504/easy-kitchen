// Netlify Function: nimmt eine Schnellnotiz (Text oder Diktat) entgegen und lässt
// Google Gemini verstehen, was gemeint ist - statt der alten simplen Stichwort-Suche.
//
// Erkennt diese Arten von Absicht:
//  - expiry:              Haltbarkeit eines vorhandenen Bestand-Artikels ändern
//  - favorite_existing:    ein bereits bekanntes Rezept als Lieblingsgericht markieren
//  - favorite_new:         ein noch unbekanntes Lieblingsgericht nennen -> die KI erstellt
//                          dafür direkt ein passendes Rezept (mit aktuellem Bestand), damit
//                          Theo es sich danach ansehen und immer wieder aufrufen kann
//  - favorite_ingredient:  eine einzelne Lieblingszutat nennen (kein ganzes Gericht) ->
//                          wird der Personalisierung (favoriteIngredients) hinzugefügt
//  - preference:           eine allgemeine Vorliebe (vegan/vegetarisch/schnell) als Filter merken
//
// Das Ergebnis wird direkt in den App-Zustand übernommen (Bestand/Favoriten/Personalisierung) -
// es gibt bewusst KEINE sichtbare Liste vergangener Notizen mehr in der App, die Notiz wird
// nur "einverleibt" statt als Text irgendwo stehen zu bleiben.
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

  const text = (payload.text || '').toString().trim();
  const kind = payload.kind === 'vorlieben' ? 'vorlieben' : 'haltbarkeit';
  const inventory = Array.isArray(payload.inventory) ? payload.inventory.filter((i) => typeof i === 'string') : [];
  const recipeNames = Array.isArray(payload.recipeNames) ? payload.recipeNames.filter((i) => typeof i === 'string') : [];

  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Keine Notiz erhalten' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server ist noch nicht eingerichtet: GEMINI_API_KEY fehlt in den Umgebungsvariablen des Hosters.' }),
    };
  }

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  // Nur relevant für "favorite_new" (die KI erstellt dabei direkt ein Rezept) - richtet sich
  // nach der echten Personalisierung statt einer fest eingebauten Ernährungs-Ausrichtung.
  const personalizationBlock = personalizationPromptBlock(payload.personalization);

  const prompt = `Du bist der Assistent einer Küchen-App für eine Einzelperson. Die Person hat gerade eine kurze Notiz gesprochen oder getippt (per Diktat, deshalb ggf. ohne Satzzeichen). Finde heraus, was gemeint ist, und antworte NUR als JSON-Objekt.

Notiz: "${text}"
Ausgewählter Reiter in der App beim Absenden (nur ein Hinweis, muss nicht stimmen - richte dich nach dem tatsächlichen Text): "${kind === 'vorlieben' ? 'Vorlieben / Rezept' : 'Haltbarkeit / Bestand'}"${personalizationBlock}

Aktueller Bestand zuhause:
${inventory.length ? inventory.map((n) => `- ${n}`).join('\n') : '(nichts erfasst)'}

Bereits bekannte Rezepte in der App:
${recipeNames.length ? recipeNames.map((n) => `- ${n}`).join('\n') : '(keine)'}

Ordne die Notiz GENAU EINER dieser Absichten zu (Feld "intent"):
- "expiry": Es geht um die Haltbarkeit/das Ablaufdatum eines Artikels aus dem Bestand oben (z.B. "der Joghurt hält noch 3 Tage"). Setze "itemName" exakt auf den passenden Namen aus dem Bestand oben und "days" auf die Anzahl Tage ab heute.
- "favorite_existing": Die Person sagt, dass sie eines der oben bekannten Rezepte mag/gerne isst. Setze "recipeName" exakt auf den passenden Namen aus der Rezeptliste oben.
- "favorite_new": Die Person nennt ein Lieblingsgericht oder Essen, das sie gerne isst, das aber NICHT in der bekannten Rezeptliste oben steht. Erstelle in diesem Fall zusätzlich im Feld "recipe" ein konkretes, umsetzbares Rezept dafür - nutze dabei so viele der vorhandenen Bestand-Zutaten wie sinnvoll möglich. Erfinde dabei keine zusätzlichen Ernährungsvorgaben (z.B. vegan, proteinreich) hinzu, außer die Person hat das selbst so angegeben. Das Rezept soll AUSFÜHRLICH sein: 5-9 Schritte mit je 1-3 vollständigen Sätzen (Hitze, Dauer, woran man erkennt, dass es gelungen ist), alle Zutaten mit Mengenangabe für 2 Portionen (z.B. "200 g rote Linsen"), dazu "tip" (kurzer Extra-Tipp), "portions" (meist 2) und im Rezept-Objekt ein eigenes "summary" (Ein-Satz-Kurzfassung der Zubereitung, max. 25 Wörter - nicht zu verwechseln mit dem äußeren Bestätigungs-"summary").
- "favorite_ingredient": Die Person nennt eine einzelne Zutat, die sie besonders gerne (zum Kochen) mag - KEIN ganzes Gericht, sondern eine Zutat, z.B. "ich koche total gern mit Ingwer" oder "Süßkartoffeln mag ich total gerne". Setze "ingredientName" auf die genannte Zutat.
- "preference": Eine allgemeine Vorliebe ohne konkretes Gericht oder konkrete Zutat, z.B. "ich mag es gern vegan" oder "am liebsten was Schnelles". Setze "tag" auf genau eines von "vegan", "vegetarisch" oder "schnell".
- "unclear": Nichts von dem oben passt eindeutig, oder der Bestand-Artikel/das Gericht/die Zutat lässt sich nicht sicher zuordnen.

Setze immer auch "summary": eine kurze, freundliche deutsche Bestätigung (max. 12 Wörter) was gespeichert wurde, z.B. "Haltbarkeit von Joghurt auf 3 Tage gesetzt" oder "„Kürbissuppe" als Lieblingsgericht gespeichert" oder bei "unclear" z.B. "Notiz gespeichert, aber nichts Konkretes erkannt".

Felder, die nicht zutreffen, leer lassen bzw. auf 0 setzen (aber immer alle Felder im JSON mitschicken).

Antworte AUSSCHLIESSLICH als JSON-Objekt mit genau diesen Feldern:
{
  "intent": "expiry" | "favorite_existing" | "favorite_new" | "favorite_ingredient" | "preference" | "unclear",
  "itemName": "<Bestand-Name oder leer>",
  "days": <Ganzzahl, 0 falls unzutreffend>,
  "recipeName": "<bekannter Rezeptname oder leer>",
  "ingredientName": "<genannte Lieblingszutat oder leer>",
  "tag": "vegan" | "vegetarisch" | "schnell" | "",
  "summary": "<kurze deutsche Bestätigung>",
  "recipe": {
    "name": "<Rezeptname oder leer>",
    "tags": ["passende Stichworte, leer falls unzutreffend"],
    "time": <Minuten, 0 falls unzutreffend>,
    "kcal": <kcal pro Portion, 0 falls unzutreffend>,
    "protein": <Gramm Protein pro Portion, 0 falls unzutreffend>,
    "portions": <Ganzzahl, meist 2; 0 falls unzutreffend>,
    "ingredientsHave": ["Zutaten mit Menge, die laut Bestand oben schon da sind, leer falls unzutreffend"],
    "ingredientsMissing": ["zusätzlich benötigte Zutaten mit Menge, leer falls unzutreffend"],
    "steps": ["ausführliche Zubereitungsschritte auf Deutsch (siehe favorite_new), leer falls unzutreffend"],
    "tip": "<kurzer Extra-Tipp oder leer>",
    "summary": "<Ein-Satz-Kurzfassung der Zubereitung oder leer>"
  }
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
            temperature: 0.4,
            // Groß genug für Intent-Felder UND ein ggf. komplettes AUSFÜHRLICHES Rezept-Objekt
            // (favorite_new) - gleiche Lehre wie bei generateRecipe.js: zu knapp
            // abgeschnittenes JSON ist unparsbar.
            maxOutputTokens: 3072,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                intent: { type: 'STRING', enum: ['expiry', 'favorite_existing', 'favorite_new', 'favorite_ingredient', 'preference', 'unclear'] },
                itemName: { type: 'STRING' },
                days: { type: 'INTEGER' },
                recipeName: { type: 'STRING' },
                ingredientName: { type: 'STRING' },
                tag: { type: 'STRING' },
                summary: { type: 'STRING' },
                recipe: {
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
              required: ['intent', 'itemName', 'days', 'recipeName', 'ingredientName', 'tag', 'summary', 'recipe'],
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
    const text2 = candidate && candidate.content &&
      candidate.content.parts && candidate.content.parts[0] &&
      candidate.content.parts[0].text;
    const finishReason = candidate && candidate.finishReason;

    let parsed = null;
    if (text2) {
      try {
        parsed = JSON.parse(text2);
      } catch (e) {
        const match = text2.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch (e2) { parsed = null; }
        }
      }
    }

    if (!parsed || typeof parsed.intent !== 'string') {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Die KI konnte die Notiz nicht auswerten. Versuch es mit einer anderen Formulierung.',
          details: `finishReason=${finishReason || 'unbekannt'}, hadText=${Boolean(text2)}, textPreview="${String(text2 || '').slice(0, 200)}"`,
        }),
      };
    }

    const validIntents = ['expiry', 'favorite_existing', 'favorite_new', 'favorite_ingredient', 'preference', 'unclear'];
    const rec = parsed.recipe && typeof parsed.recipe === 'object' ? parsed.recipe : {};
    const clean = {
      intent: validIntents.includes(parsed.intent) ? parsed.intent : 'unclear',
      itemName: typeof parsed.itemName === 'string' ? parsed.itemName.trim().slice(0, 80) : '',
      days: Number.isFinite(Number(parsed.days)) ? Math.max(0, Math.min(730, Math.round(Number(parsed.days)))) : 0,
      recipeName: typeof parsed.recipeName === 'string' ? parsed.recipeName.trim().slice(0, 80) : '',
      ingredientName: typeof parsed.ingredientName === 'string' ? parsed.ingredientName.trim().slice(0, 60) : '',
      tag: ['vegan', 'vegetarisch', 'schnell'].includes(parsed.tag) ? parsed.tag : '',
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim().slice(0, 160) : 'Notiz gespeichert',
      recipe: {
        name: typeof rec.name === 'string' ? rec.name.trim().slice(0, 80) : '',
        tags: Array.isArray(rec.tags) ? rec.tags.filter((t) => typeof t === 'string').slice(0, 6) : [],
        time: Number.isFinite(Number(rec.time)) ? Math.max(0, Math.round(Number(rec.time))) : 0,
        kcal: Number.isFinite(Number(rec.kcal)) ? Math.max(0, Math.round(Number(rec.kcal))) : 0,
        protein: Number.isFinite(Number(rec.protein)) ? Math.max(0, Math.round(Number(rec.protein))) : 0,
        portions: Number.isFinite(Number(rec.portions)) ? Math.max(0, Math.min(12, Math.round(Number(rec.portions)))) : 0,
        ingredientsHave: Array.isArray(rec.ingredientsHave) ? rec.ingredientsHave.filter((i) => typeof i === 'string').slice(0, 20) : [],
        ingredientsMissing: Array.isArray(rec.ingredientsMissing) ? rec.ingredientsMissing.filter((i) => typeof i === 'string').slice(0, 20) : [],
        steps: Array.isArray(rec.steps) ? rec.steps.filter((s) => typeof s === 'string').slice(0, 12) : [],
        tip: typeof rec.tip === 'string' ? rec.tip.trim().slice(0, 300) : '',
        summary: typeof rec.summary === 'string' ? rec.summary.trim().slice(0, 220) : '',
      },
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unerwarteter Fehler bei der KI-Anfrage', details: String(err) }),
    };
  }
};
