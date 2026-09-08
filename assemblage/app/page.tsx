import Link from 'next/link'
import { ArrowUpRight, ChevronDown, Database, Dna, Globe2, MapPinned } from 'lucide-react'
import { project, species } from '@/lib/mock-species'

const previewArcs = species.slice(0, 4)

function MiniMap() {
  return (
    <div className="mini-map atlas-grid" aria-label="Decorative preview of collection and submitter sites">
      <svg viewBox="0 0 1000 480" role="img" aria-hidden="true">
        <path className="world-shape" d="M90 132l70-45 106 14 60 52-25 46-76 8-33 38-46-16-19-58-46-9zm290 38 40-29 58 19 14 52-38 32-38-22-42 14-28-37zm180-6 45-34 88 14 52 43-15 45-61-6-24 45-38-17-22-42-42-17zm150 144 35-18 43 26 22 57-33 50-43-15-12-56z" />
        {previewArcs.map((item) => { const a = project(item.collection.lat, item.collection.lng); const b = project(item.submitter.lat, item.submitter.lng); const midX = (a.x + b.x) / 2; const midY = Math.min(a.y, b.y) - 70; return <path key={item.id} className="preview-arc" d={`M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`} /> })}
        {species.slice(0, 8).map((item) => { const p = project(item.collection.lat, item.collection.lng); return <circle key={`c-${item.id}`} className="preview-dot collection-dot" cx={p.x} cy={p.y} r="7" /> })}
        {species.slice(0, 8).map((item) => { const p = project(item.submitter.lat, item.submitter.lng); return <rect key={`s-${item.id}`} className="preview-dot submitter-dot" x={p.x - 5} y={p.y - 5} width="10" height="10" /> })}
      </svg>
      <div className="mini-map-label"><span className="eyebrow">Live specimen atlas</span><span>12 records · 8 countries</span></div>
    </div>
  )
}

export default function Page() {
  return <main className="landing-shell">
    <nav className="top-nav landing-nav">
      <Link href="/" className="wordmark">Assemblage<span className="wordmark-dot">.</span></Link>
      <span className="mock-badge">MVP mock</span>
      <div className="nav-links"><a href="#about">About</a><Link href="/map" className="nav-map-link">Open the map <ArrowUpRight size={14} /></Link></div>
    </nav>
    <section className="landing-hero">
      <div className="hero-copy">
        <p className="eyebrow"><span className="eyebrow-rule" /> INSDC assemblies · mock data</p>
        <h1>Is the South rich in species and poor in genomes?</h1>
        <p className="hero-subcopy">Assemblage traces where species are collected and where their genomes are assembled. The gap between those two points reveals who gets to build the reference record.</p>
        <div className="hero-actions"><Link href="/map" className="button button-primary">Explore the map <ArrowUpRight size={17} /></Link><a href="#about" className="text-button">How to read this <ChevronDown size={16} /></a></div>
      </div>
      <div className="hero-visual"><MiniMap /><div className="visual-caption"><span>FIELD SITE</span><span>SUBMITTER</span><span>FLOW</span></div></div>
    </section>
    <section className="stat-strip" aria-label="Mock data highlights">
      <div className="stat"><strong>68<span>%</span></strong><p>of mock assemblies from Southern samples were submitted in the North</p></div>
      <div className="stat"><strong>12 <span className="stat-unit">of 17</span></strong><p>megadiverse countries appear mainly as collection sites</p></div>
      <div className="stat"><strong>41<span>%</span></strong><p>of records have no usable coordinates <em>unknown</em></p></div>
    </section>
    <section className="about-section" id="about">
      <div className="section-intro"><p className="eyebrow"><span className="eyebrow-rule" /> How to read the atlas</p><h2>Two maps, one species.</h2><p>Every record carries two geographies. Assemblage puts them back in the same frame.</p></div>
      <div className="reading-grid">
        <article className="reading-card"><div className="card-icon amber-icon"><MapPinned size={18} /></div><span className="card-kicker">01 / Collected</span><h3>Where the specimen entered the record.</h3><p>Locality and country from the field sample. A place with biodiversity, context, and often limited sequencing infrastructure.</p></article>
        <article className="reading-card"><div className="card-icon blue-icon"><Database size={18} /></div><span className="card-kicker">02 / Submitted</span><h3>Where the assembly was deposited.</h3><p>Institution and country associated with the genome assembly. A proxy for where computation and curation happened.</p></article>
        <article className="reading-card flow-card"><div className="card-icon flow-icon"><Dna size={18} /></div><span className="card-kicker">03 / Flow</span><h3>The distance between them.</h3><p>Follow the arc. South → North is not a verdict — it is a pattern worth making visible.</p><Link href="/map" className="card-link">See the flow <ArrowUpRight size={15} /></Link></article>
      </div>
    </section>
    <footer className="landing-footer"><div><Globe2 size={16} /><span>Assemblage / field notes</span></div><p><strong>Reading the caveat:</strong> geo_loc_name is sample collection, not always wild origin. Submitter country is a proxy for “where assembled”, not the sequencer. Data will come from INSDC / GenBank later.</p></footer>
  </main>
}
