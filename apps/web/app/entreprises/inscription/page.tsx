import type { Metadata } from 'next';
import { establishments } from '@/lib/companies/store';
import { currentSite } from '@/lib/site/store';
import { ActionForm, Notice } from '../../administration/forms';
import { learner } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Inscrire une entreprise' };
export const dynamic = 'force-dynamic';

type Search = { error?: string; message?: string };

export default async function Inscription({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings } = await learner();
  const search = await searchParams;
  const site = await currentSite();
  const places = await establishments(settings);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/entreprises">Entreprises partenaires</a> › <span aria-current="page">Inscription</span></nav>
      <section className="studio-heading"><p className="eyebrow">Entreprise</p><h1>Inscrire mon entreprise</h1>
        <p>Après l’inscription, déposez l’immatriculation et le mandat du représentant. L’établissement vérifie puis approuve l’entreprise.</p></section>
      <Notice error={search.error} message={search.message} />
      <ActionForm action="/api/v1/ent/register" back="/entreprise" submit="Inscrire l’entreprise">
        <label>Établissement partenaire<select name="scopeId" defaultValue={site?.scope_id}>{places.map(place => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label>
        <label>Raison sociale<input name="name" required maxLength={200} /></label>
        <label>Forme juridique<input name="legalForm" maxLength={100} placeholder="SARL, SA, association…" /></label>
        <label>Numéro d’immatriculation<input name="registrationNumber" required maxLength={80} /></label>
        <label>Pays d’immatriculation<input name="country" required maxLength={100} /></label>
        <label>Secteur d’activité<input name="sector" maxLength={200} /></label>
        <label>Ville<input name="city" maxLength={200} /></label>
        <label>Site web<input name="website" type="url" placeholder="https://" /></label>
        <label>Nom du représentant<input name="representativeName" required maxLength={200} /></label>
        <label>Fonction du représentant<input name="representativeTitle" required maxLength={200} /></label>
        <label>Courriel de contact<input name="contactEmail" type="email" maxLength={254} /></label>
        <label>Téléphone<input name="contactPhone" maxLength={40} /></label>
        <label className="studio-wide">Adresse (privée)<textarea name="address" maxLength={1000} rows={2} /></label>
        <label className="studio-wide">Présentation publique<textarea name="description" maxLength={4000} rows={4} /></label>
      </ActionForm>
    </main>
  );
}
