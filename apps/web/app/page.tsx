export default function Home() {
  return <main id="contenu">
    <section className="welcome">
      <div><p>Université numérique ouest-africaine</p><h1>Le campus numérique</h1>
      <a className="action" href="#formations">Consulter les formations</a></div>
      <img src="/campus.webp" alt="" width="950" height="520"/>
    </section>
    <section id="formations"><h2>Formations</h2>
      <p>Le catalogue ouvrira après la publication des premières formations par l’université.</p>
    </section>
  </main>;
}
