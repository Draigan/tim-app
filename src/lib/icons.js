export const ICON_OPTIONS = [
  { key: 'trash',    label: 'Dumpster'        },
  { key: 'package',  label: 'Storage'         },
  { key: 'car',      label: 'Vehicle'         },
  { key: 'stairs',   label: 'Bleachers'       },
  { key: 'tool',     label: 'Equipment'       },
  { key: 'fence',        label: 'Fencing'         },
]

// Tabler icon bodies (24x24 viewBox), bundled so icons render without reaching
// api.iconify.design — a failed fetch there left map pins as blank circles.
export const TABLER_ICONS = {
  'trash': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16m-10 4v6m4-6v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>',
  'package': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m12 3l8 4.5v9L12 21l-8-4.5v-9zm0 9l8-4.5M12 12v9m0-9L4 7.5m12-2.25l-8 4.5"/>',
  'car': '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0m10 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M5 17H3v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0H9m-6-6h15m-6 0V6"/></g>',
  'stairs': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M22 5h-5v5h-5v5H7v5H2"/>',
  'tool': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 10h3V7L6.5 3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1-3 3l-6-6a6 6 0 0 1-8-8z"/>',
  'toilet-paper': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10a3 7 0 1 0 6 0a3 7 0 1 0-6 0m18 0c0-3.866-1.343-7-3-7M6 3h12m3 7v10l-3-1l-3 2l-3-3l-3 2V10m-3 0h.01"/>',
  'fence': '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12v4h16v-4zm2 4v4h4v-4m0-4V6L8 4L6 6v6m8 4v4h4v-4m0-4V6l-2-2l-2 2v6"/>',
}

export function tablerSvg(key, size = 14, color = '374151') {
  const body = TABLER_ICONS[key]
  if (!body) return ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${body.replace(/currentColor/g, `#${color}`)}</svg>`
}

export function iconImgUrl(key, size = 20) {
  return `data:image/svg+xml,${encodeURIComponent(tablerSvg(key, size))}`
}
