import { describe, expect, test } from 'bun:test'

import type { Editor } from '@open-pencil/core'
import type { SkiaRenderer } from '@open-pencil/core/canvas'

import { importIconMatcher } from '@/app/editor/icons/provider'
import { appPreferences } from '@/app/settings/preferences/store'

/** A renderer to draw icons with; building a matcher draws nothing, so CanvasKit goes unused. */
const renderer = { ck: {} } as SkiaRenderer
const editor = { renderer } as Editor

describe('naming the icons in imported HTML', () => {
  test('a build with local icons names none, even with the setting on', () => {
    expect(appPreferences.value.import.nameIcons).toBe(true)
    expect(importIconMatcher(editor, undefined, true)).toBeUndefined()
  })

  test('a build without them names icons while the setting is on, as upstream does', () => {
    expect(importIconMatcher(editor, undefined, false)).toBeFunction()
  })
})
