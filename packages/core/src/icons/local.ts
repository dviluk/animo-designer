import { compact } from 'es-toolkit'

import type { createIconifyAPIClient } from './api'
import { createIconifyProvider, type IconProvider, type IconSearchOptions } from './provider'
import type { IconSet } from './schema'
import type { IconCollection, IconSearchResult } from './types'

type IconifyAPIClient = ReturnType<typeof createIconifyAPIClient>

/** An icon set in Iconify's JSON form, as an `@iconify-json/*` package ships it. */
export interface LocalIconSet extends IconSet {
  info?: {
    name: string
    total?: number
    category?: string
    license?: { title: string }
    palette?: boolean
  }
}

const DEFAULT_SEARCH_LIMIT = 5

/** A set name searched by every word of a query, so `arrow left` finds `arrow-big-left`. */
function queryWords(query: string): string[] {
  return compact(query.toLowerCase().split(/[\s-]+/))
}

/** A set's icon and alias names, in the set's own order. */
function namesOf(set: LocalIconSet): string[] {
  return [...Object.keys(set.icons), ...Object.keys(set.aliases ?? {})]
}

/**
 * Icon sets held on this machine, answering the calls the Iconify API client answers, so an icon
 * provider over it never makes a request. A set it doesn't hold is refused by name.
 */
export function createLocalIconifyClient(
  load: () => Promise<readonly LocalIconSet[]>
): IconifyAPIClient {
  let loaded: Promise<readonly LocalIconSet[]> | null = null
  // A failed load is dropped so the next call loads again.
  const sets = (): Promise<readonly LocalIconSet[]> => {
    if (!loaded) {
      const loading = load()
      loaded = loading
      void loading.catch(() => {
        if (loaded === loading) loaded = null
      })
    }
    return loaded
  }

  async function setOf(prefix: string): Promise<LocalIconSet> {
    const all = await sets()
    const found = all.find((set) => set.prefix === prefix)
    if (found) return found
    const held = all.map((set) => set.prefix).join(', ')
    throw new Error(`Icon set "${prefix}" isn't on this server; its icons come from: ${held}`)
  }

  function collectionOf(set: LocalIconSet): IconCollection {
    return {
      prefix: set.prefix,
      name: set.info?.name ?? set.prefix,
      total: set.info?.total ?? Object.keys(set.icons).length,
      category: set.info?.category ?? null,
      license: set.info?.license?.title ?? null,
      multicolor: set.info?.palette === true
    }
  }

  return {
    async fetchCollection(prefix: string): Promise<IconSet> {
      return setOf(prefix)
    },

    async collections(): Promise<IconCollection[]> {
      return (await sets()).map(collectionOf)
    },

    async collectionIcons(prefix: string): Promise<string[]> {
      return Object.keys((await setOf(prefix)).icons).map((name) => `${prefix}:${name}`)
    },

    async search(query: string, options?: IconSearchOptions): Promise<IconSearchResult> {
      const words = queryWords(query)
      if (words.length === 0) return { icons: [], total: 0, collections: {} }
      const [first] = words
      const whole = words.join('-')
      const searched = (await sets()).filter(
        (set) => !options?.prefix || set.prefix === options.prefix
      )
      // Exact names first, then names that start with the query, as Iconify ranks them.
      const exact: string[] = []
      const leading: string[] = []
      const rest: string[] = []
      const collections: IconSearchResult['collections'] = {}
      for (const set of searched) {
        let matched = 0
        for (const name of namesOf(set)) {
          if (!words.every((word) => name.includes(word))) continue
          matched++
          const full = `${set.prefix}:${name}`
          if (name === whole) exact.push(full)
          else if (name.startsWith(first)) leading.push(full)
          else rest.push(full)
        }
        if (matched === 0) continue
        const { name, total, category } = collectionOf(set)
        collections[set.prefix] = { name, total, ...(category ? { category } : {}) }
      }
      const icons = [...exact, ...leading, ...rest]
      return {
        icons: icons.slice(0, options?.limit ?? DEFAULT_SEARCH_LIMIT),
        total: icons.length,
        collections
      }
    }
  }
}

/** A provider over sets held on this machine: nothing is fetched, and other sets are refused. */
export function createLocalIconProvider(
  load: () => Promise<readonly LocalIconSet[]>
): IconProvider {
  return createIconifyProvider(createLocalIconifyClient(load))
}

/** Lucide, bundled with this package, loaded once on first use since it is large. */
export async function loadLucideIconSet(): Promise<LocalIconSet> {
  const { icons, info } = await import('@iconify-json/lucide')
  return { ...icons, info }
}
