/**
 * Copy and Paste after a detach inside a component, of an instance that holds an instance: the held
 * instance, the detached layer and the component each copy, and each paste, from the window's own
 * copy and from the clipboard's Figma format, shows what was copied.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { createEditorStore, type EditorStore } from '@/app/editor/session'

import { runCleanups } from '#tests/helpers/collab/cloud'
import {
  BLUE,
  childNamed,
  inComponent,
  type Look,
  look,
  READERS,
  RED,
  settle,
  showPage,
  tabReading,
  topLayer
} from '#tests/helpers/collab/component-tabs'

afterEach(runCleanups)

/**
 * Screens and Parts after the graph's page: Parts with Pip, Badge, which holds an instance of Pip,
 * and Rack, which holds an instance of Badge whose Pip it changes; Screens with an instance of Rack.
 */
async function rackFile(): Promise<Uint8Array> {
  await initCodec()
  const graph = new SceneGraph()
  const screens = graph.addPage('Screens')
  const parts = graph.addPage('Parts')
  const pip = graph.createNode('COMPONENT', parts.id, { name: 'Pip', width: 40, height: 20 })
  graph.createNode('ELLIPSE', pip.id, { name: 'Core', width: 8, height: 8, fills: [BLUE] })
  graph.createNode('TEXT', pip.id, { name: 'Label', x: 10, width: 30, height: 12, text: 'Pip' })
  const badge = graph.createNode('COMPONENT', parts.id, {
    name: 'Badge',
    width: 150,
    height: 20,
    y: 100
  })
  graph.createInstance(pip.id, badge.id, { name: 'PipIn' })
  const rack = graph.createNode('COMPONENT', parts.id, {
    name: 'Rack',
    width: 150,
    height: 20,
    y: 200
  })
  const badgeIn = expectDefined(graph.createInstance(badge.id, rack.id, { name: 'BadgeIn' }))
  graph.createInstance(rack.id, screens.id, { name: 'Slot' })
  const author = createEditorStore(graph)
  const pipIn = childNamed(graph, badgeIn.id, 'PipIn')
  author.updateNodeWithUndo(childNamed(graph, pipIn.id, 'Core').id, { fills: [RED] }, 'Fill')
  author.updateNodeWithUndo(childNamed(graph, pipIn.id, 'Label').id, { text: 'Rack pip' }, 'Text')
  await settle()
  const bytes = await exportFigFile(graph)
  author.preparationController.dispose()
  return bytes
}

const HELD: Look = {
  name: 'PipIn',
  type: 'INSTANCE',
  visible: true,
  children: [
    { name: 'Core', type: 'ELLIPSE', visible: true, fill: 'red', children: [] },
    { name: 'Label', type: 'TEXT', visible: true, text: 'Rack pip', children: [] }
  ]
}
const DETACHED: Look = { name: 'BadgeIn', type: 'FRAME', visible: true, children: [HELD] }

const COPIED: { what: string; layer: (tab: EditorStore) => SceneNode; shows: Look }[] = [
  {
    what: 'the instance the detached layer held',
    layer: (tab) => childNamed(tab.graph, inComponent(tab, 'Rack', 'BadgeIn').id, 'PipIn'),
    shows: HELD
  },
  {
    what: 'the detached layer',
    layer: (tab) => inComponent(tab, 'Rack', 'BadgeIn'),
    shows: DETACHED
  },
  {
    what: 'the component',
    layer: (tab) => topLayer(tab.graph, 'Parts', 'Rack'),
    shows: { name: 'Rack', type: 'COMPONENT', visible: true, children: [DETACHED] }
  }
]

/** What a layer shows: its look but for its own type, which a paste of a component may change. */
const shown = ({ type: _type, ...seen }: Look) => seen

/** The look of what a paste on Screens, with nothing selected, makes. */
async function pastedOnScreens(tab: EditorStore, paste: () => Promise<void>): Promise<Look> {
  await showPage(tab, 'Screens')
  tab.select([])
  await paste()
  await settle()
  const [id] = [...tab.state.selectedIds]
  return look(tab.graph, expectDefined(tab.graph.getNode(id ?? ''), 'the pasted layer'))
}

describe('Copy and Paste after a detach inside a component of an instance that holds an instance', () => {
  for (const reader of READERS) {
    for (const { what, layer, shows } of COPIED) {
      test(`reading on ${reader}: detaches BadgeIn in Rack, copies ${what}, and pastes it on Screens both ways`, async () => {
        const tab = await tabReading(reader, await rackFile())
        await showPage(tab, 'Screens')
        await showPage(tab, 'Parts')
        await settle()
        tab.select([inComponent(tab, 'Rack', 'BadgeIn').id])
        tab.detachInstance()
        await settle()
        const copied = layer(tab)
        expect(look(tab.graph, copied)).toEqual(shows)

        tab.select([copied.id])
        const { html, snapshot } = await tab.prepareCopy()
        const windowsCopy = expectDefined(snapshot, "the window's copy")

        expect(shown(await pastedOnScreens(tab, () => tab.pasteSnapshot(windowsCopy)))).toEqual(
          shown(shows)
        )
        expect(shown(await pastedOnScreens(tab, () => tab.pasteFromHTML(html)))).toEqual(
          shown(shows)
        )
      })
    }
  }
})
