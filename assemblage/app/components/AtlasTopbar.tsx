import Link from 'next/link'

export type AtlasPage = 'map' | 'rankings'

const LINKS: { id: AtlasPage; href: string; label: string }[] = [
  { id: 'map', href: '/map', label: 'Map' },
  { id: 'rankings', href: '/rankings', label: 'Pull index' },
]

/** Shared header for the app pages: wordmark, then the page links with the current one highlighted. */
export default function AtlasTopbar({ current }: { current: AtlasPage }) {
  return (
    <header className="atlas-topbar">
      <Link href="/" className="wordmark">
        GenoFlow<span className="wordmark-dot">.</span>
      </Link>
      <nav className="atlas-nav" aria-label="Pages">
        {LINKS.map((link) => (
          <Link
            key={link.id}
            href={link.href}
            className={`atlas-nav-link ${current === link.id ? 'is-active' : ''}`}
            aria-current={current === link.id ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
