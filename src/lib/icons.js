export const ICON_OPTIONS = [
  { key: 'trash',    label: 'Dumpster'  },
  { key: 'package',  label: 'Storage'   },
  { key: 'car',      label: 'Vehicle'   },
  { key: 'stairs',   label: 'Bleachers' },
  { key: 'tool',     label: 'Equipment' },
]

const iconCache = {}

export async function fetchTablerIcon(key, size = 14, color = '374151') {
  const cacheKey = `${key}-${size}-${color}`
  if (iconCache[cacheKey]) return iconCache[cacheKey]
  try {
    const res = await fetch(
      `https://api.iconify.design/tabler/${key}.svg?height=${size}&color=%23${color}`
    )
    const svg = await res.text()
    iconCache[cacheKey] = svg
    return svg
  } catch {
    return ''
  }
}

export function iconImgUrl(key, size = 20) {
  return `https://api.iconify.design/tabler/${key}.svg?height=${size}&color=%23374151`
}
