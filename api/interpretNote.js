// Vercel-Einstiegspunkt für "interpretNote".
// Die eigentliche Logik liegt unverändert in ../lib/interpretNote.js und wird von
// ../lib/adapter.js auf Vercels (req, res)-Bauweise übersetzt. Dadurch ist der
// Funktionscode auf Netlify und Vercel identisch.
const { toVercel } = require('../lib/adapter');
const { handler } = require('../lib/interpretNote');

module.exports = toVercel(handler);
