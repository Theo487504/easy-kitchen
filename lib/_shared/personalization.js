// Gemeinsames Hilfsmodul: nimmt das rohe "personalization"-Feld aus dem Request-Body
// (kommt vom Frontend als state.personalization) entgegen, säubert es defensiv (öffentlich
// erreichbarer Endpoint, siehe recognize.js) und baut daraus einen kurzen Kontext-Block
// für den Gemini-Prompt. Wird von generateRecipe.js und interpretNote.js genutzt, damit
// Rezeptvorschläge sich wirklich nach den in der App hinterlegten Vorlieben richten,
// statt wie früher eine fest eingebaute Ernährungs-Ausrichtung anzunehmen.

function sanitizePersonalization(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const strArr = (v, max, len) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, max).map((x) => x.slice(0, len)) : [];
  return {
    goals: strArr(p.goals, 6, 60),
    dietType: strArr(p.dietType, 6, 40),
    dietFocus: strArr(p.dietFocus, 10, 60),
    favoriteIngredients: typeof p.favoriteIngredients === 'string' ? p.favoriteIngredients.trim().slice(0, 300) : '',
    cookTime: typeof p.cookTime === 'string' ? p.cookTime.slice(0, 40) : '',
    useStockFirst: typeof p.useStockFirst === 'string' ? p.useStockFirst.slice(0, 60) : '',
    appliances: strArr(p.appliances, 20, 50),
  };
}

function personalizationPromptBlock(raw) {
  const p = sanitizePersonalization(raw);
  const parts = [];
  if (p.dietType.length) parts.push(`Ernährungsform: ${p.dietType.join(', ')}`);
  if (p.dietFocus.length) parts.push(`Achtet zusätzlich auf: ${p.dietFocus.join(', ')}`);
  if (p.favoriteIngredients) parts.push(`Kocht besonders gern mit: ${p.favoriteIngredients}`);
  if (p.cookTime) parts.push(`Hat meistens Zeit zum Kochen: ${p.cookTime}`);
  if (p.useStockFirst === 'Ja, möglichst wenig dazukaufen') {
    parts.push('Möchte möglichst wenig zusätzlich einkaufen - Rezept bevorzugt aus dem vorhandenen Bestand zusammenstellen.');
  }
  if (p.appliances.length) {
    // Leere Liste = keine Angabe -> bewusst KEINE Einschränkung, sonst würden Leute
    // ohne ausgefüllte Geräteliste plötzlich nur noch Rohkost-Rezepte bekommen.
    parts.push(
      `Verfügbare Küchengeräte: ${p.appliances.join(', ')}. Das Rezept MUSS sich allein damit zubereiten lassen - ` +
      'schlage nichts vor, das ein nicht aufgeführtes Gerät braucht, und nenne in den Schritten nur diese Geräte.'
    );
  }
  if (!parts.length) return '';
  return `\n\nPersönliche Vorlieben der Person aus ihrer Personalisierung (mit berücksichtigen, aber ihr ausdrücklicher Wunsch oben hat weiterhin Vorrang):\n${parts.map((x) => `- ${x}`).join('\n')}`;
}

module.exports = { sanitizePersonalization, personalizationPromptBlock };
