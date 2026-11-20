import { currentSite, type PublicSite } from '@/lib/site/store';
import { Markup } from '@/lib/lms/markup';
import { SiteMissing } from './site-missing';

// Published site texts are rendered with the restricted markup: no HTML is injected.
export async function SiteTextPage({ field, title }: { field: keyof PublicSite; title: string }) {
  const site = await currentSite();
  if (!site) return <SiteMissing />;
  const value = site[field];
  return (
    <main id="contenu" className="sheet">
      <section className="page-heading"><p className="eyebrow">{site.name}</p><h1>{title}</h1></section>
      {typeof value === 'string' ? <Markup source={value} /> : <p className="card-note">Ce texte n’est pas encore publié.</p>}
    </main>
  );
}
