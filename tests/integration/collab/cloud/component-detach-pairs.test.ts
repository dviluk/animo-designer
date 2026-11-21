/**
 * Two instances of one component inside a component: Pip twice in Pair. When Pair's instance in a
 * component is detached, an instance read before the detach keeps across the save what it changed
 * inside each, though both name Pip as their component. When both are detached in Pair, a change
 * saved after a reopen still saves and opens: the save gives the detached layers no keys, which
 * would be one key for two layers.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditorStore, type EditorStore } from '@/app/editor/session'

import { runCleanups } from '#tests/helpers/collab/cloud'
import {
  BLUE,
  bobAndAnn,
  childNamed,
  inComponent,
  type Look,
  lookOn,
  READERS,
  RED,
  save,
  settle,
  showPage,
  tabReading,
  topLayer
} from '#tests/helpers/collab/component-tabs'

afterEach(runCleanups)

/**
 * Cover, Screens and Parts. Parts holds Pip, a blue Core and a Label; Pair, holding PipL and PipR,
 * two instances of Pip; and Shelf, holding PairIn, an instance of Pair. Screens holds Duo, an
 * instance of Pair, and Row, an instance of Shelf, which fills Core red inside PipL, and hides PipR
 * and changes its Label.
 */
async function pairedFile(): Promise<Uint8Array> {
  await initCodec()
  const graph = new SceneGraph()
  const [cover] = graph.getPages()
  if (!cover) throw new Error('Expected a page')
  graph.updateNode(cover.id, { name: 'Cover' })
  const screens = graph.addPage('Screens')
  const parts = graph.addPage('Parts')
  const pip = graph.createNode('COMPONENT', parts.id, { name: 'Pip', width: 40, height: 20 })
  graph.createNode('ELLIPSE', pip.id, { name: 'Core', width: 8, height: 8, fills: [BLUE] })
  graph.createNode('TEXT', pip.id, { name: 'Label', x: 10, width: 30, height: 12, text: 'Pip' })
  const pair = graph.createNode('COMPONENT', parts.id, {
    name: 'Pair',
    width: 90,
    height: 20,
    y: 100
  })
  graph.createInstance(pip.id, pair.id, { name: 'PipL' })
  graph.createInstance(pip.id, pair.id, { name: 'PipR', x: 50 })
  const shelf = graph.createNode('COMPONENT', parts.id, {
    name: 'Shelf',
    width: 90,
    height: 20,
    y: 200
  })
  graph.createInstance(pair.id, shelf.id, { name: 'PairIn' })
  graph.createInstance(pair.id, screens.id, { name: 'Duo' })
  const row = graph.createInstance(shelf.id, screens.id, { name: 'Row', y: 100 })
  if (!row) throw new Error('Expected the Row')
  const author = createEditorStore(graph)
  const pairIn = childNamed(graph, row.id, 'PairIn').id
  const left = childNamed(graph, pairIn, 'PipL').id
  const right = childNamed(graph, pairIn, 'PipR').id
  author.updateNodeWithUndo(childNamed(graph, left, 'Core').id, { fills: [RED] }, 'Fill')
  author.updateNodeWithUndo(childNamed(graph, right, 'Label').id, { text: 'Changed' }, 'Text')
  author.updateNodeWithUndo(right, { visible: false }, 'Hide')
  await settle()
  const bytes = await exportFigFile(graph)
  author.preparationController.dispose()
  return bytes
}

/** A copy of Pip, `name`, of `type`, shown or not, with its Core's fill and its Label's words. */
const pipLook = (
  name: string,
  type: string,
  visible: boolean,
  fill: string,
  text: string
): Look => ({
  name,
  type,
  visible,
  children: [
    { name: 'Core', type: 'ELLIPSE', visible: true, fill, children: [] },
    { name: 'Label', type: 'TEXT', visible: true, text, children: [] }
  ]
})

/** The Row, its PairIn of `type`, with Core red inside PipL, and PipR hidden with its Label changed. */
const changedRow = (type: string): Look => ({
  name: 'Row',
  type: 'INSTANCE',
  visible: true,
  children: [
    {
      name: 'PairIn',
      type,
      visible: true,
      children: [
        pipLook('PipL', 'INSTANCE', true, 'red', 'Pip'),
        pipLook('PipR', 'INSTANCE', false, 'blue', 'Changed')
      ]
    }
  ]
})

/** Detaches, with the editor's own action, `name` in the copy of `component` on top. */
function detach(tab: EditorStore, component: string, name: string): void {
  tab.select([inComponent(tab, component, name).id])
  tab.detachInstance()
}

/**
 * PairIn's detach leaves PipL and PipR instances of Pip that Shelf holds itself, so both name Pip as
 * their component. The Row read before the detach keeps across the save what it changed inside
 * each, on that one: the save tells them apart by the link the detach kept for each.
 */
describe('a detach inside a component of an instance holding two instances of one component, which an instance on a page already shown overrides inside each', () => {
  for (const reader of READERS) {
    test(`one window reading on ${reader}: shows Screens, detaches PairIn in Shelf, and saves`, async () => {
      const tab = await tabReading(reader, await pairedFile())
      await showPage(tab, 'Screens')
      await settle()
      detach(tab, 'Shelf', 'PairIn')
      await settle()

      const saved = await save(tab)

      expect(lookOn(tab.graph, 'Screens', 'Row')).toEqual(changedRow('INSTANCE'))
      expect(lookOn(saved, 'Screens', 'Row')).toEqual(changedRow('FRAME'))
    })

    test(`two windows, Bob reading on ${reader}: Bob shows Screens, Ann joins, shows Parts and detaches PairIn in Shelf, and each saves`, async () => {
      const { bob, ann } = await bobAndAnn(reader, await pairedFile())
      detach(ann, 'Shelf', 'PairIn')
      await settle()

      const bobs = await save(bob)
      const anns = await save(ann)

      expect(lookOn(bob.graph, 'Screens', 'Row')).toEqual(changedRow('INSTANCE'))
      expect(lookOn(bobs, 'Screens', 'Row')).toEqual(changedRow('FRAME'))
      expect(lookOn(anns, 'Screens', 'Row')).toEqual(changedRow('FRAME'))
    })
  }
})

/** How many overrides `name`, a layer of Pair, holds: a detached layer's are the detach's links. */
const overridesIn = (tab: EditorStore, name: string): number => {
  const { self, descendants } = inComponent(tab, 'Pair', name).instanceOverrides
  return self.size + descendants.size
}

/**
 * PipL and PipR detached in Pair, saved and reopened; then Duo fills Core red inside PipL and
 * changes the Label inside PipR, saved and reopened on every page. Each of Pip's layers has a copy
 * in both detached layers, so a key the save copied from Pip onto them would name two layers, and
 * that second save would fail on Duo's paths. The detach's links live on each detached layer until
 * the save, which writes no frame's overrides, so the reopened layers hold none: no copy built
 * before the detach is left to need them.
 */
describe('two instances of one component detached inside a component, then a change saved after a reopen', () => {
  for (const reader of READERS) {
    test(`reading on ${reader}: detaches PipL and PipR in Pair, saves and reopens, changes Duo inside both, saves and reopens every page`, async () => {
      const tab = await tabReading(reader, await pairedFile())
      await showPage(tab, 'Parts')
      await settle()
      detach(tab, 'Pair', 'PipL')
      await settle()
      detach(tab, 'Pair', 'PipR')
      await settle()
      expect([overridesIn(tab, 'PipL'), overridesIn(tab, 'PipR')]).toEqual([2, 2])
      const reopened = await tabReading(reader, await exportFigFile(tab.graph))
      await showPage(reopened, 'Parts')
      await settle()
      expect([overridesIn(reopened, 'PipL'), overridesIn(reopened, 'PipR')]).toEqual([0, 0])
      await showPage(reopened, 'Screens')
      await settle()
      const { graph } = reopened
      const duo = topLayer(graph, 'Screens', 'Duo')
      const left = childNamed(graph, duo.id, 'PipL').id
      const right = childNamed(graph, duo.id, 'PipR').id
      reopened.updateNodeWithUndo(childNamed(graph, left, 'Core').id, { fills: [RED] }, 'Fill')
      reopened.updateNodeWithUndo(childNamed(graph, right, 'Label').id, { text: 'Again' }, 'Text')
      await settle()

      const again = await tabReading(reader, await exportFigFile(graph))
      for (const page of ['Cover', 'Screens', 'Parts']) await showPage(again, page)
      await settle()

      expect(lookOn(again.graph, 'Screens', 'Duo')).toEqual({
        name: 'Duo',
        type: 'INSTANCE',
        visible: true,
        children: [
          pipLook('PipL', 'FRAME', true, 'red', 'Pip'),
          pipLook('PipR', 'FRAME', true, 'blue', 'Again')
        ]
      })
    })
  }
})
