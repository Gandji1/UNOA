// Shown when no published, online site is declared for the requested host.
export function SiteMissing() {
  return (
    <main id="contenu">
      <section className="account-panel">
        <h1>Site public non configuré</h1>
        <p>Aucun site public en ligne n’est déclaré pour cette adresse. L’administration habilitée le configure depuis
          « Mon espace › Site public » : nom, textes, mentions légales, langues et noms d’hôte.</p>
        <p className="hero-actions"><a className="action" href="/espace">Mon espace</a></p>
      </section>
    </main>
  );
}
