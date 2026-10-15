const PATHS = {
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h4M18 9v6a4 4 0 0 1-4 4h-4',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  team: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 9v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  close: 'M18 6 6 18M6 6l12 12',
  locate: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  lasso: 'M7 21c1-2 1-4-1-5M12 4c5 0 9 2.5 9 6s-4 6-9 6-9-2.5-9-6 4-6 9-6z',
  layers: 'm12 2 10 6-10 6L2 8l10-6zM2 16l10 6 10-6',
  door: 'M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18M15 12h.01',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  nav: 'm3 11 19-9-9 19-2-8-8-2z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M20 6 9 17l-5-5',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  arrow: 'M5 12h14M12 5l7 7-7 7',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, title }: { name: IconName; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  )
}

export function Logo() {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true">
      <path d="M120 360 C 190 360, 200 250, 270 250 S 360 160, 392 150" fill="none" stroke="#f2b632" strokeWidth="34" strokeLinecap="round" strokeDasharray="2 60" />
      <circle cx="120" cy="360" r="44" fill="#f2b632" />
      <path d="M392 90c-40 0-72 32-72 72 0 54 72 124 72 124s72-70 72-124c0-40-32-72-72-72z" fill="#fff" />
      <circle cx="392" cy="162" r="26" fill="#12324a" />
    </svg>
  )
}
