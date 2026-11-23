import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { navigation, studioDescriptions } from '@/lib/iam/navigation';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { database, sessionAccount } from '@/lib/iam/sessions';
import { levelLabels, roleGuide, setupProgress, setupSteps } from '@/lib/iam/guide';
import { ActionForm, Badge } from './forms';
import { developmentMode } from '@/lib/iam/local';
import { handoffs, myTasks } from '@/lib/iam/handoff';
import { allowedCreations } from '@/lib/iam/navigation';
import { HandoffPanel } from './handoff';

export const metadata: Metadata = { title: 'Administration' };
export const dynamic = 'force-dynamic';

// Studios grouped by level: what the platform configures, what each
// institution configures, and teaching. Each studio checks its own rights.
const levels: [string, string, string[]][] = [
  ['Plateforme et pays', 'Super-administrateur (pays) et administrateurs pays (établissements et campus)', ['/administration/acces', '/administration/territoires', '/administration/parametres']],
  ['Établissement', 'Administrateur d’établissement (campus) : site, facultés et départements, admissions, scolarité, messages',
    ['/administration/site', '/administration/structures', '/administration/admissions', '/administration/scolarite', '/administration/notifications']],
  ['Faculté, département et pédagogie', 'Doyens, chefs de département, responsables de formation et enseignants : filières, formations, matières, cours et séances en direct',
    ['/administration/catalogue', '/administration/cours']],
];

export default async function Administration() {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const { groups } = await navigation();
  const studios = new Map(groups.flatMap(group => group.items).filter(item => item.href.startsWith('/administration/') && !item.href.includes('?')).map(item => [item.href, item]));
  const { rows: [root] } = await database(settings).query<{ platform: boolean; country: boolean }>(
    `SELECT unoa.has_scope_permission($1, 'iam.read', id) AS platform, 'territory.write' = ANY(unoa.account_permissions($1)) AS country
     FROM unoa.scope WHERE parent_id IS NULL`, [actor]);
  const development = await developmentMode(settings).catch(() => false);
  const [relay, tasks, creations] = await Promise.all([handoffs(settings, actor), myTasks(settings, actor), allowedCreations(actor)]);
  const [progress, roles] = await Promise.all([root?.platform || root?.country ? setupProgress(settings) : Promise.resolve(null), roleGuide(settings)]);
  const roleLabel = new Map(roles.map(role => [role.code, role.label ?? role.code]));
  const { rows: mine } = await database(settings).query<{ role_label: string | null; role_code: string; scope_label: string }>(
    'SELECT role_label, role_code, scope_label FROM unoa.iam_account($1, $1) WHERE revoked_at IS NULL AND (effective_until IS NULL OR effective_until > now())', [actor]);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Administration</span></nav>
      <section className="studio-heading"><p className="eyebrow">Console d’administration</p><h1>Administration</h1>
        <p>Vos rôles : {mine.length ? mine.map(item => `${item.role_label ?? item.role_code} (${item.scope_label})`).join(' · ') : 'aucun'}.
          {' '}<a href="/administration/guide">Qui fait quoi ?</a></p></section>
      <HandoffPanel items={relay} tasks={tasks} />
      {creations.length > 0 && (
        <section className="studio-panel" aria-labelledby="creer">
          <h2 id="creer">Ce que vous pouvez créer</h2>
          <p className="studio-actions">{creations.map(item => <a key={item.kind} className="action" href={'/administration/creer?quoi=' + item.kind}>
            {item.kind === 'responsable' ? item.label : 'Créer ' + item.label.toLowerCase()}</a>)}</p>
        </section>
      )}
      {root?.platform && (
        <section className="studio-panel" aria-labelledby="developpement">
          <h2 id="developpement">Mode développement</h2>
          <p>{development ? 'Activé : mots de passe libres, aucun blocage après erreurs. À désactiver avant l’ouverture au public.' : 'Désactivé : mots de passe robustes et blocage après 5 erreurs.'}</p>
          <ActionForm inline action="/api/v1/iam/development-mode" back="/administration" hidden={{ enabled: development ? 'false' : 'true' }}
            submit={development ? 'Désactiver le mode développement' : 'Activer le mode développement'} />
        </section>
      )}
      {studios.size === 0 && <p className="card-note">Aucun rôle d’administration ne vous est attribué. Demandez une invitation à un administrateur.</p>}

      {progress && (
        <section className="studio-panel" aria-labelledby="mise-en-route">
          <h2 id="mise-en-route">Mise en route de la plateforme</h2>
          <p><strong>Hiérarchie :</strong> Super-administrateur → Administrateur pays → Administrateur d’établissement (campus) → Doyen → Chef de département → Enseignants.</p>
          <p className="studio-help">Ordre conseillé : chaque étape s’appuie sur la précédente. Les étapes « Établissement » sont réalisées par les personnes nommées pour chaque établissement.</p>
          <ol className="setup-steps">
            {setupSteps.map(step => {
              const count = progress[step.key];
              return (
                <li key={step.key}>
                  <div>
                    <strong><a href={step.href}>{step.title}</a></strong> <Badge tone={step.level === 'platform' ? 'info' : 'muted'}>{levelLabels[step.level]}</Badge>
                    {count !== undefined && (count > 0 ? <Badge tone="ok">{count} réalisé(s)</Badge> : <Badge tone="warn">À faire</Badge>)}
                    <p className="muted">{step.detail}</p>
                    <p className="muted">Par : {step.roles.map(code => roleLabel.get(code) ?? code).join(', ')}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {levels.map(([level, who, hrefs]) => {
        const available = hrefs.map(href => studios.get(href)).filter(Boolean);
        if (!available.length) return null;
        return (
          <section key={level} aria-labelledby={'niveau-' + level}>
            <h2 id={'niveau-' + level}>{level}</h2>
            <p className="muted">{who}</p>
            <ul className="admin-grid">
              {available.map(item => <li key={item!.href}><a href={item!.href}><strong>{item!.label}</strong><span className="muted">{studioDescriptions[item!.href]}</span></a></li>)}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
