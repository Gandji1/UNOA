import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { iamSettings } from '@/lib/iam/settings';
import { roleGuide, setupSteps } from '@/lib/iam/guide';
import { Badge, Table } from '../forms';

export const metadata: Metadata = { title: 'Qui fait quoi' };
export const dynamic = 'force-dynamic';

const creations: [string, string, string][] = [
  ['Types de périmètres (pays, région, établissement, campus, faculté, département…)', 'Pays et établissements → types', 'Super-administrateur'],
  ['Pays', 'Pays et établissements', 'Super-administrateur'],
  ['Administrateur de chaque pays', 'Utilisateurs et rôles → inviter (rôle Administrateur pays, sur le pays)', 'Super-administrateur'],
  ['Établissements universitaires et leurs campus', 'Pays et établissements (dans le pays)', 'Administrateur pays'],
  ['Administrateur de chaque établissement', 'Utilisateurs et rôles → inviter (sur l’établissement)', 'Administrateur pays'],
  ['Site public de l’établissement', 'Site public', 'Administrateur d’établissement'],
  ['Facultés, puis départements au sein des facultés', 'Facultés et départements', 'Administrateur d’établissement (départements : aussi le doyen)'],
  ['Doyens, chefs de département, enseignants', 'Utilisateurs et rôles → inviter (sur la faculté ou le département)', 'Administrateur d’établissement, doyen, chef de département'],
  ['Filières et spécialités d’un département', 'Catalogue → référentiels (propriétaire : le département)', 'Chef de département, doyen'],
  ['Formations, maquettes (semestres, UE, crédits) et matières', 'Catalogue → programmes et cours', 'Chef de département, responsable de formation'],
  ['Leçons, vidéos, exercices ; séances en direct avec les étudiants', 'Cours en ligne → offre → séances', 'Enseignant (validation : chef de département ou validateur)'],
  ['Campagnes de candidature', 'Admissions', 'Gestionnaire des admissions (décision : jury ; recours : commission)'],
  ['Matricules, cohortes, inscriptions', 'Scolarité', 'Gestionnaire de scolarité (validation : validateur de scolarité)'],
];

const levelLabels: Record<string, string> = { platform: 'Plateforme', territory: 'Pays', institution: 'Établissement', unit: 'Faculté / département' };

export default async function Guide() {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const roles = await roleGuide(settings);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <span aria-current="page">Qui fait quoi</span></nav>
      <section className="studio-heading"><p className="eyebrow">Guide</p><h1>Qui fait quoi, et où</h1>
        <p><strong>Super-administrateur</strong> → crée les pays et nomme les <strong>administrateurs pays</strong> → qui créent les établissements et leurs campus
          et nomment les <strong>administrateurs d’établissement</strong> → qui créent facultés et départements et nomment <strong>doyens</strong> et
          <strong>chefs de département</strong> → qui créent filières, formations et matières et nomment les <strong>enseignants</strong> → qui créent les cours
          et animent les séances en direct. Chacun n’agit que dans son périmètre ; une décision sensible revient à une autre personne que son auteur.</p></section>
      <section className="studio-panel" aria-labelledby="creations">
        <h2 id="creations">Qui crée quoi</h2>
        <Table label="Qui crée quoi" head={['Élément', 'Écran', 'Responsable']}>
          {creations.map(([what, where, who]) => <tr key={what}><td>{what}</td><td>{where}</td><td>{who}</td></tr>)}
        </Table>
      </section>
      <section className="studio-panel" aria-labelledby="ordre">
        <h2 id="ordre">Ordre de mise en route</h2>
        <ol>{setupSteps.map(step => <li key={step.key}><a href={step.href}>{step.title}</a> — {step.detail}</li>)}</ol>
      </section>
      <section className="studio-panel" aria-labelledby="roles">
        <h2 id="roles">Rôles disponibles</h2>
        <p className="studio-help">Rôles types fournis avec la plateforme ; le super-administrateur peut les modifier ou en composer d’autres (Utilisateurs et rôles → Rôles et permissions).
          Un rôle s’attribue au niveau indiqué : plateforme, pays, établissement (ou campus, faculté, département), faculté ou département.</p>
        <Table label="Rôles" head={['Rôle', 'Niveau', 'Mission', 'Permissions']}>
          {roles.map(role => (
            <tr key={role.code}><td><strong>{role.label ?? role.code}</strong></td>
              <td><Badge tone="info">{levelLabels[role.level] ?? role.level}</Badge></td>
              <td>{role.description ?? '—'}</td><td className="muted">{role.code === 'platform_admin' ? 'Toutes' : role.permissions.filter(Boolean).join(' · ')}</td></tr>
          ))}
        </Table>
      </section>
    </main>
  );
}
