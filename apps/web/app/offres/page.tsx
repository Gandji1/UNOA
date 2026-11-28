import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { documentKinds, kindLabels, opportunityDetail, publicOpportunities } from '@/lib/careers/store';
import { ActionForm, Badge, Editor, Hidden, Notice } from '../administration/forms';

export const metadata: Metadata = { title: 'Offres de stage et d’emploi' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const api = '/api/v1/car/';
const day = (value: Date) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(value));

export default async function Offres({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const settings = iamSettings();
  if (!settings) return <main id="contenu" className="page"><p>Service bientôt disponible.</p></main>;
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const id = field(search.id);
  if (scopeIdFormat.test(id)) {
    const data = await opportunityDetail(settings, id, actor).catch(() => null);
    if (data) {
      const { offer } = data;
      const back = '/offres?id=' + offer.id;
      return (
        <main id="contenu" className="studio">
          <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/offres">Offres</a> › <span aria-current="page">{offer.title}</span></nav>
          <section className="studio-heading"><p className="eyebrow">{kindLabels[offer.kind]} · {offer.company}</p><h1>{offer.title}</h1>
            <p>{[offer.city, offer.country].filter(Boolean).join(', ')}{offer.remote ? ' · télétravail possible' : ''} · candidatures jusqu’au {day(offer.closes_at)}</p></section>
          {notice}
          <section className="studio-panel">
            <p style={{ whiteSpace: 'pre-wrap' }}>{offer.description}</p>
            {offer.criteria && <><h2>Critères</h2><p style={{ whiteSpace: 'pre-wrap' }}>{offer.criteria}</p></>}
            <p className="muted">{offer.languages.length > 0 && <>Langues : {offer.languages.join(', ')} · </>}Pièces demandées : {offer.required_documents.map(kind => documentKinds[kind]).join(', ')}
              {offer.starts_on && <> · Début : {offer.starts_on}</>}</p>
            {offer.skills.length > 0 && <p>{offer.skills.map(skill => <Badge key={skill.id} tone="info">{skill.label}</Badge>)}</p>}
          </section>
          {!actor ? <p className="card-note"><a href="/connexion">Connectez-vous</a> ou <a href="/inscription">créez un compte</a> pour candidater.</p> : data.own ? <p className="card-note">Offre de votre entreprise : suivez les candidatures dans <a href="/entreprise/recrutement">Recrutement</a>.</p> : (
            <>
              {data.mine ? <p className="card-note">Candidature envoyée. Suivez-la dans <a href="/carriere#candidatures">Ma carrière</a>.</p> : data.open ? (
                <section className="studio-panel" aria-labelledby="candidater">
                  <h2 id="candidater">Candidater</h2>
                  <form method="post" action={api + 'apply'} encType="multipart/form-data" className="studio-form">
                    <Hidden values={{ return: back, opportunityId: offer.id }} />
                    <label>CV de mon espace carrière<select name="cvVersionId" defaultValue={data.cvs[0]?.id ?? ''}><option value="">Aucun (je joins un fichier)</option>{data.cvs.map(cv => <option key={cv.id} value={cv.id}>{cv.title} (v{cv.version})</option>)}</select></label>
                    {offer.required_documents.map(kind => <label key={kind}>{documentKinds[kind]} (fichier)<input type="file" name={kind + 'File'} accept=".pdf,.png,.jpg,.jpeg" /></label>)}
                    <label className="studio-wide">Lettre de motivation<textarea name="letter" rows={6} maxLength={8000} /></label>
                    <label className="studio-check studio-wide"><input type="checkbox" name="consent" required /> J’accepte que l’entreprise consulte ma candidature, mes pièces et l’instantané de mon profil pour ce recrutement.</label>
                    <div className="studio-actions"><button className="action" type="submit">Envoyer ma candidature</button></div>
                  </form>
                </section>
              ) : <p className="card-note">Candidatures closes.</p>}
              <div className="studio-actions">
                <ActionForm inline action={api + (data.favorite ? 'unfavorite' : 'favorite')} back={back} hidden={{ opportunityId: offer.id }} submit={data.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} />
              </div>
              <Editor summary="Signaler cette offre">
                <ActionForm action={api + 'report-opportunity'} back={back} hidden={{ opportunityId: offer.id }} submit="Signaler">
                  <label className="studio-wide">Motif<input name="reason" required maxLength={2000} /></label>
                </ActionForm>
              </Editor>
            </>
          )}
        </main>
      );
    }
  }
  const filters = { q: field(search.q), kind: field(search.kind), country: field(search.country), language: field(search.language) };
  const offers = await publicOpportunities(settings, filters).catch(() => []);
  return (
    <main id="contenu" className="page">
      <section className="panel">
        <div className="panel-top"><div><h1>Offres de stage et d’emploi</h1><p className="muted">Offres des entreprises partenaires vérifiées.</p></div>
          {actor && <a className="secondary" href="/carriere">Ma carrière</a>}</div>
        {notice}
        <form method="get" action="/offres" className="filters compact" role="search" aria-label="Rechercher une offre">
          <label className="grow">Recherche<input type="search" name="q" defaultValue={filters.q} placeholder="Métier, entreprise, mot-clé…" /></label>
          <label>Nature<select name="kind" defaultValue={filters.kind}><option value="">Toutes</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Pays<input name="country" defaultValue={filters.country} maxLength={100} /></label>
          <label>Langue<input name="language" defaultValue={filters.language} maxLength={3} placeholder="fr" /></label>
          <button className="action" type="submit">Rechercher</button>
        </form>
        {offers.length === 0 ? <p>Aucune offre ne correspond pour le moment.</p> : (
          <ul className="program-grid">{offers.map(offer => (
            <li key={offer.id} className="program-card">
              <p className="muted">{kindLabels[offer.kind]} · {offer.company}</p>
              <h2><a href={'/offres?id=' + offer.id}>{offer.title}</a></h2>
              <p className="muted">{[offer.city, offer.country].filter(Boolean).join(', ')}{offer.remote ? ' · télétravail' : ''} · jusqu’au {day(offer.closes_at)}</p>
              {offer.skills.length > 0 && <p>{offer.skills.slice(0, 4).map(skill => <Badge key={skill} tone="info">{skill}</Badge>)}</p>}
            </li>
          ))}</ul>
        )}
      </section>
    </main>
  );
}
