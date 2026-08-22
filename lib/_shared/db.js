// Gemeinsame Datenbank-Verbindung fürs Haushalt-Sharing (Neon PostgreSQL, direkt über
// Neons eigenes Serverless-SDK statt über das mittlerweile abgekündigte @vercel/postgres
// - siehe https://neon.com/docs/guides/vercel-postgres-transition-guide). Ein einziger
// Pool pro warmer Function-Instanz - wird beim Kaltstart einmal aufgebaut und danach
// zwischen Aufrufen wiederverwendet, statt bei jeder Anfrage neu zu verbinden.
//
// Die Vercel/Neon-Integration benennt die Verbindungs-Umgebungsvariable je nach
// Einrichtungsweg unterschiedlich (DATABASE_URL, POSTGRES_URL, ...) - deshalb werden
// hier alle gängigen Namen der Reihe nach probiert, statt sich auf einen einzigen
// festzulegen.
const { Pool } = require('@neondatabase/serverless');

let pool = null;

function getPool() {
  if (pool) return pool;

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    throw new Error(
      'Server ist noch nicht eingerichtet: Keine Datenbank-Verbindung gefunden. ' +
        'Bitte in den Vercel-Projekteinstellungen unter "Environment Variables" prüfen, ' +
        'ob DATABASE_URL (oder POSTGRES_URL) gesetzt ist.'
    );
  }

  pool = new Pool({ connectionString });
  return pool;
}

module.exports = { getPool };
