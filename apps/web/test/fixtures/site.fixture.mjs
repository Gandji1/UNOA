import assert from 'node:assert/strict';

// Two public sites for two establishments, reached through two host names of
// the same server. Brand and texts are data, versioned and published by a
// second person; each site only exposes its own scope.
export async function exerciseSites({ database, post, get, okay, status, origin, author, publisher, alphaUniv, betaUniv }) {
  const api = '/api/v1/site/';
  const alphaHost = new URL(origin).host;
  const betaOrigin = 'http://localhost:' + new URL(origin).port;
  const site = async (scopeId) => (await okay(await post(api + 'sites', author, { scopeId, defaultLanguage: 'fr' }))).id;
  const alpha = await site(alphaUniv);
  await status(await post(api + 'sites', author, { scopeId: alphaUniv, defaultLanguage: 'fr' }), 409, 'un site par portée');
  await status(await post(`${api}sites/${alpha}/online`, publisher, { online: true }), 422, 'en ligne sans texte publié');
  await okay(await post(`${api}sites/${alpha}/hosts`, author, { host: alphaHost }));
  await status(await post(`${api}sites/${alpha}/hosts`, author, { host: 'Hôte invalide' }), 400, 'hôte invalide');
  const save = (siteId, data) => post(`${api}sites/${siteId}/texts`, author, { language: 'fr', ...data });
  const first = (await okay(await save(alpha, {
    name: 'Université Alpha (recette)', shortName: 'Alpha', tagline: 'Établissement fictif de recette', heroTitle: 'Campus Alpha',
    heroText: 'Texte d’accueil configuré.', legalNotice: '# Éditeur\nUniversité fictive de recette.', privacyNotice: 'Politique fictive.',
    footer: 'Alpha · recette', contact: 'contact@alpha.invalid',
  }))).id;
  await status(await post(`${api}sites/${alpha}/publish`, author, { textId: first }), 403, 'auto-publication');
  await okay(await post(`${api}sites/${alpha}/publish`, publisher, { textId: first }));
  await okay(await post(`${api}sites/${alpha}/online`, publisher, { online: true }));
  let home = await (await get('/')).text();
  assert.match(home, /Campus Alpha/);
  assert.match(home, /<title>Université Alpha \(recette\)<\/title>/);
  assert.match(await (await get('/mentions-legales')).text(), /Université fictive de recette/);
  assert.match(await (await get('/formations')).text(), /<title>Formations · Alpha<\/title>/);

  const second = (await okay(await save(alpha, { name: 'Université Alpha (recette)', shortName: 'Alpha', heroTitle: 'Campus Alpha modifié' }))).id;
  assert.doesNotMatch(await (await get('/')).text(), /Campus Alpha modifié/, 'un brouillon n’est pas publié');
  await okay(await post(`${api}sites/${alpha}/publish`, publisher, { textId: second }));
  assert.match(await (await get('/')).text(), /Campus Alpha modifié/);
  const english = (await okay(await save(alpha, { language: 'en', name: 'Alpha University (test)', shortName: 'Alpha' }))).id;
  await okay(await post(`${api}sites/${alpha}/publish`, publisher, { textId: english }));
  home = await (await get('/', null, { 'Accept-Language': 'en-GB,en;q=0.8' })).text();
  assert.match(home, /Alpha University \(test\)/);
  assert.match(home, /<html lang="en"/);
  const history = await database.query('SELECT state FROM unoa.site_text WHERE site_id = $1 AND language = $2 ORDER BY created_at', [alpha, 'fr']);
  assert.deepEqual(history.rows.map(row => row.state), ['archived', 'published']);
  await assert.rejects(database.query("UPDATE unoa.site_text SET name = 'Réécrit' WHERE id = $1", [first]), /immutable/);

  const beta = await site(betaUniv);
  await status(await post(`${api}sites/${beta}/hosts`, author, { host: alphaHost }), 409, 'hôte déjà attribué');
  await okay(await post(`${api}sites/${beta}/hosts`, author, { host: new URL(betaOrigin).host }));
  const betaText = (await okay(await save(beta, { name: 'Université Bêta (recette)', shortName: 'Bêta', heroTitle: 'Campus Bêta' }))).id;
  await okay(await post(`${api}sites/${beta}/publish`, publisher, { textId: betaText }));
  await okay(await post(`${api}sites/${beta}/online`, publisher, { online: true }));
  const betaHome = await (await fetch(betaOrigin + '/')).text();
  assert.match(betaHome, /Campus Bêta/);
  assert.doesNotMatch(betaHome, /Campus Alpha/);
  return { betaOrigin };
}
