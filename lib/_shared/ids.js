// Erzeugt IDs und Haushalts-Codes fürs Haushalt-Sharing.
const crypto = require('crypto');

function generateId() {
  return crypto.randomUUID();
}

// Ohne 0/O, 1/I/L - die werden beim Vorlesen/Abtippen des Codes am häufigsten verwechselt.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

module.exports = { generateId, generateCode };
