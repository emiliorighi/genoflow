/** Predefined multi-country atlas regions for the Custom tab. */

export type CustomRegionId = 'latin-america' | 'global-south' | 'global-north'

export type CustomRegionDef = {
  id: CustomRegionId
  name: string
  description: string
}

/** ASEAN + Timor-Leste. China is excluded by not being listed. */
export const SE_ASIA_ISO3 = new Set([
  'BRN',
  'KHM',
  'IDN',
  'LAO',
  'MYS',
  'MMR',
  'PHL',
  'SGP',
  'THA',
  'TLS',
  'VNM',
])

const LATAM_EXCLUDED_NORTH_AMERICA = new Set(['USA', 'CAN', 'GRL'])
const GLOBAL_NORTH_EXTRA = new Set(['CAN', 'USA', 'JPN'])

const EXCLUDED_NA_NAMES = new Set([
  'usa',
  'united states',
  'united states of america',
  'canada',
  'greenland',
])

const GLOBAL_NORTH_EXTRA_NAMES = new Set([
  'usa',
  'united states',
  'united states of america',
  'canada',
  'japan',
])

export const CUSTOM_REGIONS: CustomRegionDef[] = [
  {
    id: 'latin-america',
    name: 'Latin America',
    description: 'South America plus Mexico, Central America, and the Caribbean',
  },
  {
    id: 'global-south',
    name: 'Global South',
    description: 'Latin America, Africa, and Southeast Asia',
  },
  {
    id: 'global-north',
    name: 'Global North',
    description: 'Europe, Canada, USA, and Japan',
  },
]

export const CUSTOM_REGION_IDS: CustomRegionId[] = CUSTOM_REGIONS.map((r) => r.id)

export function isCustomRegionId(value: string | null | undefined): value is CustomRegionId {
  return Boolean(value && (CUSTOM_REGION_IDS as string[]).includes(value))
}

export function customRegionLabel(id: string | null | undefined): string | null {
  if (!isCustomRegionId(id)) return null
  return CUSTOM_REGIONS.find((r) => r.id === id)?.name ?? id
}

function normalizeCountryName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

function isExcludedNorthAmerica(iso3: string | null, countryName: string | null): boolean {
  if (iso3 && LATAM_EXCLUDED_NORTH_AMERICA.has(iso3)) return true
  return EXCLUDED_NA_NAMES.has(normalizeCountryName(countryName))
}

/** Membership test for a collection site (works with or without ISO3). */
export function isCustomRegionMember(
  id: CustomRegionId,
  iso3: string | null,
  continent: string,
  countryName: string | null = null,
): boolean {
  if (id === 'latin-america') {
    if (continent === 'South America') return true
    if (continent === 'North America') {
      return !isExcludedNorthAmerica(iso3, countryName)
    }
    return false
  }

  if (id === 'global-south') {
    if (isCustomRegionMember('latin-america', iso3, continent, countryName)) return true
    if (continent === 'Africa') return true
    if (iso3 && SE_ASIA_ISO3.has(iso3)) return true
    return false
  }

  // global-north
  if (continent === 'Europe') return true
  if (iso3 && GLOBAL_NORTH_EXTRA.has(iso3)) return true
  return GLOBAL_NORTH_EXTRA_NAMES.has(normalizeCountryName(countryName))
}

/** Resolve member ISO3 codes for a custom region from a continent lookup. */
export function buildCustomRegionIso3Set(
  id: CustomRegionId,
  continentLookup: Map<string, string>,
): Set<string> {
  const set = new Set<string>()
  for (const [iso3, continent] of continentLookup) {
    if (isCustomRegionMember(id, iso3, continent, null)) set.add(iso3)
  }
  return set
}

export function buildAllCustomIso3Sets(
  continentLookup: Map<string, string>,
): Map<CustomRegionId, Set<string>> {
  const map = new Map<CustomRegionId, Set<string>>()
  for (const id of CUSTOM_REGION_IDS) {
    map.set(id, buildCustomRegionIso3Set(id, continentLookup))
  }
  return map
}

export function customIso3SetForFilter(
  customId: string | null | undefined,
  sets: Map<CustomRegionId, Set<string>> | null | undefined,
): Set<string> | null {
  if (!isCustomRegionId(customId) || !sets) return null
  return sets.get(customId) ?? null
}
