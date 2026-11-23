import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { iamSettings } from '@/lib/iam/settings';
import { roleGuide, setupSteps } from '@/lib/iam/guide';
import { Badge, Table } from '../forms';

export const metadata: Metadata = { title: 'Qui fait quoi' };
export const dynamic = 'force-dynamic';

const creations: [string, string, string][] = [
  ['Territoires, pays, régions, juridictions', 'Territoires', 'Super-administrateur, gestionnaire des territoires'],
  ['Établissements (universités, instituts) et campus ou centres', 'Territoires', 'Super-administrateur, gestionnaire des territoires'],
  ['Administrateur de chaque établissement', 'Accès et rôles → inviter', 'Super-administrateur'],
  ['Site public de l’établissement', 'Site public', 'Administrateur d’établissement (rédaction : rédacteur du site)'],
  ['Facultés, écoles, départements, laboratoires', 'Structures académiques', 'Administrateur d’établissement, responsable académique'],
  ['Domaines, filières, mentions, spécialités, parcours', 'Catalogue → référentiels', 'Responsable académique'],
  ['Formations (licence, master, certificat…) et maquettes', 'Catalogue → programmes', 'Responsable académique, responsable de formation'],
  ['UE et matières (cours du catalogue)', 'Catalogue → maquette et cours', 'Responsable académique, responsable de formation'],
  ['Leçons, vidéos, exercices, séances en visioconférence', 'Studio des cours', 'Enseignant (validation : validateur pédagogique)'],
  ['Campagnes et formulaires de candidature', 'Admissions', 'Gestionnaire des admissions (décision : jury ; recours : commission)'],
  ['Matricules, cohortes, inscriptions', 'Scolarité', 'Gestionnaire de scolarité (validation : validateur de scolarité)'],
  ['Rôles sur mesure, comptes, journal d’audit', 'Accès et rôles', 'Super-administrateur, administrateur d’établissement (dans ses limites)'],
];

export default async function Guide() {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const roles = await roleGuide(settings);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <span aria-current="page">Qui fait quoi</span></nav>
      <section className="studio-heading"><p className="eyebrow">Guide</p><h1>Qui fait quoi, et où</h1>
        <p>Deux niveaux : la <strong>plateforme</strong> (super-administrateur) crée les territoires et les établissements et nomme leurs administrateurs ;
          chaque <strong>établissement</strong> configure ensuite ses structures, formations, admissions et scolarité. Une même personne peut cumuler
          plusieurs rôles ; une décision sensible revient toujours à une autre personne que son auteur.</p></section>
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
        <p className="studio-help">Rôles types fournis avec la plateforme ; le super-administrateur peut les modifier ou en composer d’autres (Accès et rôles → Rôles et permissions).
          Un rôle « Plateforme » s’attribue sur la plateforme ; un rôle « Établissement » sur un établissement ou une de ses composantes.</p>
        <Table label="Rôles" head={['Rôle', 'Niveau', 'Mission', 'Permissions']}>
          {roles.map(role => (
            <tr key={role.code}><td><strong>{role.label ?? role.code}</strong></td>
              <td>{role.level === 'platform' ? <Badge tone="info">Plateforme</Badge> : <Badge tone="muted">Établissement</Badge>}</td>
              <td>{role.description ?? '—'}</td><td className="muted">{role.code === 'platform_admin' ? 'Toutes' : role.permissions.filter(Boolean).join(' · ')}</td></tr>
          ))}
        </Table>
      </section>
    </main>
  );
}
