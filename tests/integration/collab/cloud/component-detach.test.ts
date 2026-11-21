/**
 * A layer whose type changes in place, inside a component a tab's reader built or on a page: a
 * detach, a group turned into a frame or a frame turned into a group. Later pages with an instance
 * of that component show the layer as the component now has it, every save goes through, and the
 * saved file reopens with the layer and all it holds, in one window and in two. What instances
 * changed on such a layer, or on one deleted inside a component, is in
 * `component-detach-overrides.test.ts`.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'

import { runCleanups } from '#tests/helpers/collab/cloud'
import {
  bobAndAnn,
  inComponent,
  pageNamed,
  READERS,
  save,
  settle,
  showPage,
  tabReading,
  topLayer
} from '#tests/helpers/collab/component-tabs'

afterEach(runCleanups)

/**
 * Cover; Screens with three frames, a Bar, a Solo dot and a Tile; Parts with the bar's component,
 * Progress, whose fill and rest are followed by a Dot instance, the Dot component, and a Card
 * holding a group; and More with another Bar and Tile. A tab reads a page only when it shows it,
 * and showing Screens builds Progress, Dot and Card.
 */
async function storedFile(): Promise<Uint8Array> {
  await initCodec()
  const graph = new SceneGraph()
  const [cover] = graph.getPages()
  if (!cover) throw new Error('Expected a page')
  graph.updateNode(cover.id, { name: 'Cover' })
  const screens = graph.addPage('Screens')
  const parts = graph.addPage('Parts')
  const more = graph.addPage('More')
  const progress = graph.createNode('COMPONENT', parts.id, {
    name: 'Progress',
    layoutMode: 'HORIZONTAL',
    width: 396,
    height: 8
  })
  graph.createNode('RECTANGLE', progress.id, { name: 'Fill', width: 300, height: 8 })
  graph.createNode('RECTANGLE', progress.id, { name: 'Rest', width: 88, height: 8, layoutGrow: 1 })
  const dot = graph.createNode('COMPONENT', parts.id, { name: 'Dot', width: 8, height: 8, y: 300 })
  graph.createNode('ELLIPSE', dot.id, { name: 'Spot', width: 8, height: 8 })
  graph.createInstance(dot.id, progress.id, { name: 'Dot' })
  const card = graph.createNode('COMPONENT', parts.id, {
    name: 'Card',
    width: 100,
    height: 40,
    y: 400
  })
  const cap = graph.createNode('GROUP', card.id, { name: 'Cap', width: 20, height: 20 })
  graph.createNode('RECTANGLE', cap.id, { name: 'Mark', width: 20, height: 20 })
  for (const name of ['One', 'Two', 'Three']) {
    graph.createNode('FRAME', screens.id, { name, width: 40, height: 40 })
  }
  for (const page of [screens, more]) {
    const bar = graph.createInstance(progress.id, page.id, { name: 'Bar', width: 358, y: 100 })
    const [fill, rest] = bar ? graph.getChildren(bar.id) : []
    if (!fill || !rest) throw new Error('Expected the fill and the rest')
    graph.updateNode(fill.id, { width: 90 })
    graph.updateNode(rest.id, { width: 260 })
    graph.createInstance(card.id, page.id, { name: 'Tile', y: 200 })
  }
  graph.createInstance(dot.id, screens.id, { name: 'Solo', x: 500, y: 100 })
  return exportFigFile(graph)
}

interface Layer {
  name: string
  type: string
  size: string
  children: Layer[]
}

/** A layer and all it holds: each one's name, type and size. */
function tree(graph: SceneGraph, node: SceneNode): Layer {
  return {
    name: node.name,
    type: node.type,
    size: `${node.width}×${node.height}`,
    children: graph.getChildren(node.id).map((child) => tree(graph, child))
  }
}

const layerOn = (graph: SceneGraph, page: string, name: string): Layer =>
  tree(graph, topLayer(graph, page, name))

const layer = (name: string, type: string, size: string, children: Layer[] = []): Layer => ({
  name,
  type,
  size,
  children
})

const spot = layer('Spot', 'ELLIPSE', '8×8')

/** The dot as a frame, with the spot it held as an instance. */
const dotFrame = (name: string) => layer(name, 'FRAME', '8×8', [spot])

/** The component with its dot, and a Bar of it with the bar's own sizes. */
const progressWith = (dotLayer: Layer) =>
  layer('Progress', 'COMPONENT', '396×8', [
    layer('Fill', 'RECTANGLE', '300×8'),
    layer('Rest', 'RECTANGLE', '88×8'),
    dotLayer
  ])
const barWith = (dotLayer: Layer) =>
  layer('Bar', 'INSTANCE', '358×8', [
    layer('Fill', 'RECTANGLE', '90×8'),
    layer('Rest', 'RECTANGLE', '260×8'),
    dotLayer
  ])

/**
 * A Bar read before its component changed, on a page shown or a page an earlier save read. Its
 * sizes pin a fault of the instance sync: any change inside a component, a plain rename included,
 * puts the component's sizes over the sizes Figma derived for the copies already read, in the
 * window and in the save. Such a copy also takes a new name but keeps its type until the design is
 * reopened.
 */
const shownBarWith = (dotLayer: Layer) =>
  layer('Bar', 'INSTANCE', '396×8', [
    layer('Fill', 'RECTANGLE', '300×8'),
    layer('Rest', 'RECTANGLE', '88×8'),
    dotLayer
  ])

/** Detaches, with the editor's own action, the dot in the copy of the bar's component on top. */
function detachDot(tab: EditorStore, rename?: string): void {
  const dot = inComponent(tab, 'Progress', 'Dot')
  tab.select([dot.id])
  tab.detachInstance()
  if (rename) tab.updateNodeWithUndo(dot.id, { name: rename }, 'Rename')
}

describe('a detach inside a component the tab built, then a page with an instance of it', () => {
  for (const reader of READERS) {
    for (const rename of [undefined, 'Badge']) {
      const steps = rename ? 'detaches the dot and renames it' : 'detaches the dot'
      test(`one window reading on ${reader}: shows Screens, ${steps}, then shows More and saves`, async () => {
        const tab = await tabReading(reader, await storedFile())
        await showPage(tab, 'Screens')
        await settle()
        detachDot(tab, rename)
        await settle()
        await showPage(tab, 'More')
        await settle()

        const saved = await save(tab)

        const detached = dotFrame(rename ?? 'Dot')
        expect(layerOn(saved, 'Parts', 'Progress')).toEqual(progressWith(detached))
        expect(layerOn(saved, 'More', 'Bar')).toEqual(barWith(detached))
        expect(layerOn(saved, 'Screens', 'Bar')).toEqual(shownBarWith(detached))
        expect(layerOn(tab.graph, 'Parts', 'Progress')).toEqual(progressWith(detached))
        expect(layerOn(tab.graph, 'More', 'Bar')).toEqual(barWith(detached))
        expect(layerOn(tab.graph, 'Screens', 'Bar')).toEqual(
          shownBarWith(layer(rename ?? 'Dot', 'INSTANCE', '8×8', [spot]))
        )
      })
    }

    test(`one window reading on ${reader}: shows Screens, detaches the dot, and saves, the save alone reading More`, async () => {
      const tab = await tabReading(reader, await storedFile())
      await showPage(tab, 'Screens')
      await settle()
      detachDot(tab)
      await settle()

      const saved = await save(tab)

      expect(layerOn(saved, 'Parts', 'Progress')).toEqual(progressWith(dotFrame('Dot')))
      expect(layerOn(saved, 'More', 'Bar')).toEqual(barWith(dotFrame('Dot')))
    })

    test(`one window reading on ${reader}: detaches the dot, undoes, saves, redoes and saves`, async () => {
      const tab = await tabReading(reader, await storedFile())
      await showPage(tab, 'Screens')
      await settle()
      const instance = layer('Dot', 'INSTANCE', '8×8', [spot])
      detachDot(tab)
      await settle()

      tab.undoAction()
      await settle()
      const undone = await save(tab)
      tab.redoAction()
      await settle()
      const redone = await save(tab)

      expect(layerOn(undone, 'Parts', 'Progress')).toEqual(progressWith(instance))
      expect(layerOn(undone, 'More', 'Bar')).toEqual(barWith(instance))
      expect(layerOn(redone, 'Parts', 'Progress')).toEqual(progressWith(dotFrame('Dot')))
      // The first save read More, so the sync's size fault that shownBarWith pins reaches its Bar.
      expect(layerOn(redone, 'More', 'Bar')).toEqual(shownBarWith(dotFrame('Dot')))
      expect(layerOn(tab.graph, 'Parts', 'Progress')).toEqual(progressWith(dotFrame('Dot')))
    })

    test(`two windows, Bob reading on ${reader}: Bob shows Screens, Ann joins, shows Parts, detaches and renames the dot in the copy on top, and each shows More and saves`, async () => {
      const { bob, ann } = await bobAndAnn(reader, await storedFile())
      detachDot(ann, 'Badge')
      await settle()
      await showPage(bob, 'More')
      await settle()
      await showPage(ann, 'More')
      await settle()

      const bobs = await save(bob)
      const anns = await save(ann)

      // Bob's reader built the copy Ann detached. Ann's own copy may stay beside it on Parts, so
      // her More may keep the dot: her save is checked on the copy she detached, and her More only
      // for going through.
      expect(layerOn(bobs, 'More', 'Bar')).toEqual(barWith(dotFrame('Badge')))
      expect(layerOn(bob.graph, 'More', 'Bar')).toEqual(barWith(dotFrame('Badge')))
      expect(layerOn(anns, 'Parts', 'Progress')).toEqual(progressWith(dotFrame('Badge')))
      expect(layerOn(anns, 'More', 'Bar').children.map((child) => child.name)).toContain('Fill')
      expect(layerOn(ann.graph, 'More', 'Bar').children.map((child) => child.name)).toContain(
        'Fill'
      )
    })
  }
})

describe('a detach of an instance on a page', () => {
  for (const reader of READERS) {
    for (const rename of [undefined, 'Badge']) {
      const steps = rename ? 'detaches the Solo dot and renames it' : 'detaches the Solo dot'
      test(`one window reading on ${reader}: shows Screens, ${steps}, and saves`, async () => {
        const tab = await tabReading(reader, await storedFile())
        await showPage(tab, 'Screens')
        await settle()
        const solo = tab.graph
          .getChildren(pageNamed(tab.graph, 'Screens'))
          .find((node) => node.name === 'Solo')
        if (!solo) throw new Error('Expected the Solo dot on Screens')
        tab.select([solo.id])
        tab.detachInstance()
        if (rename) tab.updateNodeWithUndo(solo.id, { name: rename }, 'Rename')
        await settle()

        const saved = await save(tab)

        expect(layerOn(saved, 'Screens', rename ?? 'Solo')).toEqual(dotFrame(rename ?? 'Solo'))
        expect(layerOn(tab.graph, 'Screens', rename ?? 'Solo')).toEqual(dotFrame(rename ?? 'Solo'))
      })
    }
  }
})

describe('a group inside a component turned into a frame, then a page with an instance of it', () => {
  const card = (capType: string, name = 'Card', type = 'COMPONENT') =>
    layer(name, type, '100×40', [
      layer('Cap', capType, '20×20', [layer('Mark', 'RECTANGLE', '20×20')])
    ])

  for (const reader of READERS) {
    test(`one window reading on ${reader}: shows Screens, turns the Cap in Card into a frame, then shows More and saves`, async () => {
      const tab = await tabReading(reader, await storedFile())
      await showPage(tab, 'Screens')
      await settle()
      tab.convertLayerType(inComponent(tab, 'Card', 'Cap').id, 'FRAME')
      await settle()
      await showPage(tab, 'More')
      await settle()

      const saved = await save(tab)

      expect(layerOn(saved, 'Parts', 'Card')).toEqual(card('FRAME'))
      expect(layerOn(saved, 'More', 'Tile')).toEqual(card('FRAME', 'Tile', 'INSTANCE'))
      expect(layerOn(tab.graph, 'More', 'Tile')).toEqual(card('FRAME', 'Tile', 'INSTANCE'))
    })
  }
})
