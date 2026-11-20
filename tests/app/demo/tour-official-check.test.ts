import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

import { fetchStub } from '@open-pencil/test-support/fetch'

import { fetchOfficialTour } from '@/app/cloud/community/tour'
import { HELP_MENU } from '@/app/shell/menu/schema/help'

afterEach(() => {
  mock.restore()
})

describe('the tour, in a build with the official check off', () => {
  test('is not fetched from the official server', async () => {
    const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
      fetchStub(async () => Response.error())
    )

    await expect(fetchOfficialTour(false)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('is offered in Help only while the tour feature is available', () => {
    const item = HELP_MENU.items.find((entry) => 'id' in entry && entry.id === 'open-tour')
    expect(item).toMatchObject({ feature: 'tour' })
  })
})
