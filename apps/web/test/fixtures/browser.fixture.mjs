import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium, devices } from 'playwright';

const require = createRequire(import.meta.url);

// Browser acceptance (A11Y, CMS-012): every screen, signed out and by role,
// analysed by axe-core against WCAG 2.2 A/AA, with keyboard, mobile, 200 % zoom
// and degraded-network checks. Screenshots are kept as evidence.
export async function exerciseBrowser({ issuer, login, origin, evidence }) {
  const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
  await mkdir(evidence, { recursive: true });
  const sessions = {};
  for (const subject of ['iam-admin', 'not-candidate', 'adm-first']) {
    issuer.useIdentity(subject, 'test-mfa');
    const value = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0].split('=')[1];
    sessions[subject] = [{ name: 'unoa_session', value, url: origin }];
  }
  const browser = await chromium.launch();
  const failures = [];
  try {
    async function audit(context, path, label) {
      const page = await context.newPage();
      const response = await page.goto(new URL(path, origin).href, { waitUntil: 'load' });
      assert.ok(response && response.status() < 400, `${label} : statut ${response?.status()}`);
      await page.addScriptTag({ content: axe });
      const result = await page.evaluate(async () => (await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      })).violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 3).map(node => node.target.join(' ')) })));
      for (const item of result) failures.push(`${label} — ${item.id} (${item.impact}) : ${item.nodes.join(' | ')}`);
      const structure = await page.evaluate(() => ({
        lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main#contenu').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      if (!structure.lang) failures.push(`${label} — langue du document absente`);
      if (structure.h1 !== 1) failures.push(`${label} — ${structure.h1} titres de niveau 1`);
      if (structure.main !== 1) failures.push(`${label} — zone principale #contenu absente`);
      if (structure.overflow > 1) failures.push(`${label} — défilement horizontal (${structure.overflow}px)`);
      return page;
    }

    const screens = {
      public: ['/', '/formations', '/structures', '/connexion', '/inscription', '/decisions', '/mentions-legales', '/confidentialite', '/a-propos', '/invitation/' + 'x'.repeat(43)],
      'iam-admin': ['/espace', '/administration', '/administration/acces', '/administration/acces?vue=roles', '/administration/structures',
        '/administration/catalogue', '/administration/cours', '/administration/admissions', '/administration/site', '/administration/territoires',
        '/administration/parametres', '/administration/notifications', '/administration/scolarite', '/administration/guide', '/administration/creer', '/administration/creer?quoi=faculte', '/administration/gouvernance', '/conseils', '/administration/enseignants', '/enseignement', '/evaluations', '/evaluations/gestion', '/evaluations/copie', '/apprendre', '/candidature', '/etudiant'],
      'not-candidate': ['/espace', '/candidature', '/apprendre'],
    };
    const shapes = { bureau: { viewport: { width: 1280, height: 860 } }, mobile: devices['Pixel 5'], zoom200: { viewport: { width: 640, height: 860 } } };
    for (const [shape, options] of Object.entries(shapes)) {
      for (const [who, paths] of Object.entries(screens)) {
        const context = await browser.newContext({ ...options, locale: 'fr-FR' });
        if (who !== 'public') await context.addCookies(sessions[who]);
        for (const path of paths) {
          const page = await audit(context, path, `${shape} · ${who} · ${path}`);
          if (shape !== 'zoom200' && ['/', '/formations', '/administration', '/espace', '/administration/acces'].includes(path)) {
            await page.screenshot({ path: `${evidence}/${shape}-${who}-${path.replace(/[^a-z0-9]+/gi, '_') || 'accueil'}.png`, fullPage: false });
          }
          await page.close();
        }
        await context.close();
      }
    }

    // Keyboard: the first Tab reaches the skip link, which moves focus to the content.
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await context.addCookies(sessions['iam-admin']);
    const page = await context.newPage();
    await page.goto(new URL('/administration/acces', origin).href);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '#contenu', 'lien d’évitement en premier');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => location.hash), '#contenu');
    // Every interactive element has a visible focus indicator.
    const unfocusable = await page.evaluate(() => [...document.querySelectorAll('a[href], button, input, select, textarea, summary')]
      .filter(element => { element.focus(); const style = getComputedStyle(element); return document.activeElement === element
        && style.outlineStyle === 'none' && style.boxShadow === 'none'; }).length);
    if (unfocusable) failures.push(`clavier · ${unfocusable} élément(s) sans indicateur de focus visible`);
    // An error is announced to assistive technologies and explains the fix.
    await page.goto(new URL('/administration/acces?vue=roles&error=400', origin).href);
    assert.match(await page.getByRole('alert').innerText(), /Vérifiez les champs/);
    await context.close();

    // Degraded network on a mid-range phone: the public home stays light and usable.
    const phone = await browser.newContext({ ...devices['Pixel 5'] });
    const slow = await phone.newPage();
    const cdp = await phone.newCDPSession(slow);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 200 * 1024 / 8 });
    // The recette server runs in development mode: its unminified scripts are not
    // representative, so the budget covers documents, styles, fonts and images.
    let bytes = 0;
    slow.on('response', async response => {
      if (response.request().resourceType() === 'script') return;
      bytes += (await response.body().catch(() => Buffer.alloc(0))).length;
    });
    const started = Date.now();
    await slow.goto(new URL('/formations', origin).href, { waitUntil: 'domcontentloaded' });
    const elapsed = Date.now() - started;
    if (elapsed > 15_000) failures.push(`réseau dégradé · contenu affiché en ${elapsed} ms`);
    if (bytes > 600_000) failures.push(`réseau dégradé · ${Math.round(bytes / 1024)} Ko de contenu`);
    await phone.close();
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, [], 'Écarts d’accessibilité :\n' + failures.join('\n'));
}
