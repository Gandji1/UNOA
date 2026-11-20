import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { navigation, studioDescriptions } from '@/lib/iam/navigation';

export const metadata: Metadata = { title: 'Administration' };
export const dynamic = 'force-dynamic';

// Overview of the studios the session may open; each studio checks its own rights.
export default async function Administration() {
  const { groups, signedIn } = await navigation();
  if (!signedIn) redirect('/connexion');
  const studios = groups.find(group => group.label === 'Administration')?.items.filter(item => item.href !== '/administration') ?? [];
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Administration</span></nav>
      <section className="studio-heading"><p className="eyebrow">Console d’administration</p><h1>Administration</h1>
        <p>Toute la configuration de l’établissement se fait ici, sans contenu prédéfini : structures, formations, cours, admissions, site, territoires, paramètres et accès.</p></section>
      {studios.length === 0 ? <p className="card-note">Aucun rôle d’administration ne vous est attribué. Demandez une invitation à un administrateur.</p> : (
        <ul className="admin-grid">
          {studios.map(item => <li key={item.href}><a href={item.href}><strong>{item.label}</strong><span className="muted">{studioDescriptions[item.href]}</span></a></li>)}
        </ul>
      )}
    </main>
  );
}
