import { afterEach, describe, expect, test, vi } from 'bun:test'

import { createLocalIconProvider, loadLucideIconSet } from '#core/icons/local'

afterEach(() => {
  vi.restoreAllMocks()
})

function offline() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'))
}

describe('local icon sets', () => {
  test('draw, search and browse the bundled Lucide set without a request', async () => {
    const fetchMock = offline()
    const icons = createLocalIconProvider(async () => [await loadLucideIconSet()])

    const drawn = await icons.icons(['lucide:heart'], 24)
    expect(drawn.get('lucide:heart')?.paths.length).toBeGreaterThan(0)

    const found = await icons.search('heart', { limit: 50 })
    expect(found.icons[0]).toBe('lucide:heart')
    expect(found.icons.every((name) => name.startsWith('lucide:'))).toBe(true)

    expect(await icons.browse('lucide')).toContain('lucide:heart')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('refuse a set they do not hold, by its name', async () => {
    const fetchMock = offline()
    const icons = createLocalIconProvider(async () => [await loadLucideIconSet()])

    await expect(icons.icons(['mdi:home'], 24)).rejects.toThrow('Icon set "mdi"')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
