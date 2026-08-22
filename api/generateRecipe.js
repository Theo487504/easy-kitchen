// Vercel-Einstiegspunkt für "generateRecipe".
// Die eigentliche Logik liegt unverändert in ../lib/generateRecipe.js und wird von
// ../lib/adapter.js auf Vercels (req, res)-Bauweise übersetzt. Dadurch ist der
// Funktionscode auf Netlify und Vercel identisch.
const { toVercel } = require('../lib/adapter');
const { handler } = require('../lib/generateRecipe');

module.exports = toVercel(handler);
