import { invoke } from '@tauri-apps/api/core'

import {
  createIconProvider,
  createLocalIconProvider,
  createSFSymbolsProvider,
  loadLucideIconSet,
  SF_SYMBOLS_PREFIX
} from '@open-pencil/core/icons'

import { browserWebFontFetch } from '@/app/editor/fonts/browser-fetch'
import { tauriFetch } from '@/app/tauri/http'
import { IS_TAURI, LOCAL_ICONS } from '@/constants'

/** SF Symbols, drawn by the desktop app, which offers them only on a Mac that can draw them. */
const sfSymbols = createSFSymbolsProvider({
  catalogue: () => invoke<string | null>('sf_symbols_catalogue'),
  render: (request) => invoke<string | null>('sf_symbols_render', { request })
})

/**
 * Iconify's icons, with Material Symbols drawn from Google's fonts, reached as the app's web fonts
 * are, and SF Symbols on the desktop.
 */
function onlineIcons() {
  return IS_TAURI
    ? createIconProvider(tauriFetch, [{ prefixes: [SF_SYMBOLS_PREFIX], provider: sfSymbols }])
    : createIconProvider(browserWebFontFetch)
}

/** The app's icons; a build with local icons draws only the bundled Lucide set and fetches nothing. */
export const appIcons = LOCAL_ICONS
  ? createLocalIconProvider(async () => [await loadLucideIconSet()])
  : onlineIcons()
