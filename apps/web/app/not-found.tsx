export default function NotFound() {
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Page introuvable</h1>
        <p>L’adresse demandée n’existe pas ou n’est pas publiée.</p>
        <p className="hero-actions"><a className="action" href="/">Accueil</a> <a className="secondary" href="/formations">Formations</a></p>
      </section>
    </main>
  );
}
