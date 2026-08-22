// Kleiner Helfer, den beide Netlify Functions (recognize.js, generateRecipe.js) nutzen:
// Google's Gemini API antwortet gelegentlich mit HTTP 503 "currently experiencing high
// demand" - das ist ein kurzfristiges Überlastungsproblem auf Google-Seite, kein Fehler
// in unserem Code. Ein bis zwei kurze automatische Wiederholungsversuche lösen das in
// den allermeisten Fällen von selbst, ohne dass Theo manuell "Nochmal versuchen" drücken muss.

async function fetchWithRetry(url, options, { retries = 2, baseDelayMs = 500 } = {}) {
  let lastResp;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(url, options);
    if (resp.status !== 503) return resp;
    lastResp = resp;
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
    }
  }
  return lastResp;
}

module.exports = { fetchWithRetry };
