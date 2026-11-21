/**
 * A layer whose type changes in place, inside a component a tab's reader built or on a page: a
 * detach, a group turned into a frame or a frame turned into a group; and a layer deleted inside a
 * component. Later pages with an instance of that component show the layer as the component now
 * has it, every save goes through, and the saved file reopens with the layer and all it holds, in
 * one window and in two. Such an instance loses what it changed on that layer, and inside it unless
 * the change was a detach, and keeps what it changed on the component's other layers. After a
 * detach, every instance keeps what it changed inside the detached layer across a reopen: one read
 * before it, one read after it, and one drawn in the same session.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { type Fill, SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { createEditorStore, type EditorStore } from '@/app/editor/session'

import { runCleanups } from '#tests/helpers/collab/cloud'
import {
  bobAndAnn,
  childNamed,
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

const RED: Fill = { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }
const BLUE: Fill = { type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }

/** Badge's three layers that a Tag overrides, each with the shape and the text inside it. */
const BADGE_LAYERS = {
  PipIn: { shape: ['Core', 'ELLIPSE'], text: ['Label', 'Pip'] },
  Cap: { shape: ['Tick', 'RECTANGLE'], text: ['Note', 'Note'] },
  Box: { shape: ['Mark', 'RECTANGLE'], text: ['Word', 'Word'] }
} as const
type BadgeLayer = keyof typeof BADGE_LAYERS

/**
 * Screens, Parts and More after the graph's pages: Parts with Pip and Badge, which holds an instance
 * of Pip, a group and a frame, each with a blue shape and a text inside; and Screens and More, each
 * with a Tag, returned by page.
 */
function drawBadge(graph: SceneGraph): Map<string, SceneNode> {
  const screens = graph.addPage('Screens')
  const parts = graph.addPage('Parts')
  const more = graph.addPage('More')
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
  const cap = graph.createNode('GROUP', badge.id, { name: 'Cap', x: 50, width: 40, height: 20 })
  graph.createNode('RECTANGLE', cap.id, { name: 'Tick', width: 8, height: 8, fills: [BLUE] })
  graph.createNode('TEXT', cap.id, { name: 'Note', x: 10, width: 30, height: 12, text: 'Note' })
  const box = graph.createNode('FRAME', badge.id, { name: 'Box', x: 100, width: 40, height: 20 })
  graph.createNode('RECTANGLE', box.id, { name: 'Mark', width: 8, height: 8, fills: [BLUE] })
  graph.createNode('TEXT', box.id, { name: 'Word', x: 10, width: 30, height: 12, text: 'Word' })
  const tagOn = new Map<string, SceneNode>()
  for (const page of [screens, more]) {
    const tag = graph.createInstance(badge.id, page.id, { name: 'Tag' })
    if (!tag) throw new Error(`Expected the Tag on ${page.name}`)
    tagOn.set(page.name, tag)
  }
  return tagOn
}

/**
 * The author's own edits, so each one is an override the Tag holds: the Tag on each page that
 * `overriding` names hides each of Badge's three layers, fills the shape inside it red and changes
 * the text inside it.
 */
function overrideTags(
  author: EditorStore,
  tagOn: ReadonlyMap<string, SceneNode>,
  overriding: readonly string[]
): void {
  const { graph } = author
  for (const page of overriding) {
    const tag = tagOn.get(page)
    if (!tag) throw new Error(`Expected the Tag on ${page}`)
    for (const [name, { shape, text }] of Object.entries(BADGE_LAYERS)) {
      const layer = childNamed(graph, tag.id, name)
      author.updateNodeWithUndo(childNamed(graph, layer.id, shape[0]).id, { fills: [RED] }, 'Fill')
      author.updateNodeWithUndo(
        childNamed(graph, layer.id, text[0]).id,
        { text: 'Changed' },
        'Text'
      )
      author.updateNodeWithUndo(layer.id, { visible: false }, 'Hide')
    }
  }
}

/** A graph of one page, Cover. */
function coverGraph(): SceneGraph {
  const graph = new SceneGraph()
  const [cover] = graph.getPages()
  if (!cover) throw new Error('Expected a page')
  graph.updateNode(cover.id, { name: 'Cover' })
  return graph
}

/**
 * Cover, then Badge and its Tags (`drawBadge`), the Tag on each page that `overriding` names
 * changed (`overrideTags`). Showing Screens builds Badge and Pip, and nothing reads More until a tab
 * shows it or a save reads it.
 */
async function overriddenFile(overriding: readonly string[] = ['More']): Promise<Uint8Array> {
  await initCodec()
  const graph = coverGraph()
  const tagOn = drawBadge(graph)
  const author = createEditorStore(graph)
  overrideTags(author, tagOn, overriding)
  await settle()
  const bytes = await exportFigFile(graph)
  author.preparationController.dispose()
  return bytes
}

/** A layer and all it holds: each one's name, type and visibility, a shape's fill, a text's words. */
interface Look {
  name: string
  type: string
  visible: boolean
  fill?: string
  text?: string
  children: Look[]
}

const COLOR_NAMES = new Map([
  ['1,0,0', 'red'],
  ['0,0,1', 'blue']
])

function colorName({ color }: Fill): string {
  const rgb = `${color.r},${color.g},${color.b}`
  return COLOR_NAMES.get(rgb) ?? rgb
}

function look(graph: SceneGraph, node: SceneNode): Look {
  const seen: Look = {
    name: node.name,
    type: node.type,
    visible: node.visible,
    children: graph.getChildren(node.id).map((child) => look(graph, child))
  }
  const [paint] = node.fills
  if (paint && (node.type === 'RECTANGLE' || node.type === 'ELLIPSE')) seen.fill = colorName(paint)
  if (node.type === 'TEXT') seen.text = node.text
  return seen
}

const lookOn = (graph: SceneGraph, page: string, name: string): Look =>
  look(graph, topLayer(graph, page, name))

/** One of Badge's layers in the Tag on More, with the Tag's overrides or as Badge has it. */
function badgeLayer(name: BadgeLayer, type: string, overridden: boolean): Look {
  const {
    shape: [shape, shapeType],
    text: [text, words]
  } = BADGE_LAYERS[name]
  return {
    name,
    type,
    visible: !overridden,
    children: [
      {
        name: shape,
        type: shapeType,
        visible: true,
        fill: overridden ? 'red' : 'blue',
        children: []
      },
      {
        name: text,
        type: 'TEXT',
        visible: true,
        text: overridden ? 'Changed' : words,
        children: []
      }
    ]
  }
}

const tagWith = (...layers: Look[]): Look => ({
  name: 'Tag',
  type: 'INSTANCE',
  visible: true,
  children: layers
})

/** Detaches, with the editor's own action, PipIn in the copy of Badge on top. */
function detachPipInOf(tab: EditorStore): void {
  tab.select([inComponent(tab, 'Badge', 'PipIn').id])
  tab.detachInstance()
}

/**
 * A Tag after PipIn's detach: PipIn as Badge's frame, with every change inside it and on the other
 * two layers, and without the hide on PipIn, which a layer whose type changed loses.
 */
const detachedTag = tagWith(
  { ...badgeLayer('PipIn', 'FRAME', true), visible: true },
  badgeLayer('Cap', 'GROUP', true),
  badgeLayer('Box', 'FRAME', true)
)

describe('a change inside a component that an instance on a page not yet shown overrides, on the changed layer and inside it', () => {
  const detachPipIn = {
    steps: 'detaches PipIn',
    change: detachPipInOf,
    tag: detachedTag
  }
  const changes = [
    detachPipIn,
    {
      steps: 'turns the Cap group into a frame',
      change: (tab: EditorStore) =>
        tab.convertLayerType(inComponent(tab, 'Badge', 'Cap').id, 'FRAME'),
      tag: tagWith(
        badgeLayer('PipIn', 'INSTANCE', true),
        badgeLayer('Cap', 'FRAME', false),
        badgeLayer('Box', 'FRAME', true)
      )
    },
    {
      steps: 'turns the Box frame into a group',
      change: (tab: EditorStore) =>
        tab.convertLayerType(inComponent(tab, 'Badge', 'Box').id, 'GROUP'),
      tag: tagWith(
        badgeLayer('PipIn', 'INSTANCE', true),
        badgeLayer('Cap', 'GROUP', true),
        badgeLayer('Box', 'GROUP', false)
      )
    },
    {
      steps: 'deletes PipIn',
      change: (tab: EditorStore) => {
        tab.select([inComponent(tab, 'Badge', 'PipIn').id])
        tab.deleteSelected()
      },
      tag: tagWith(badgeLayer('Cap', 'GROUP', true), badgeLayer('Box', 'FRAME', true))
    }
  ]

  for (const reader of READERS) {
    for (const { steps, change, tag } of changes) {
      test(`one window reading on ${reader}: shows Screens, ${steps} in Badge, then shows More and saves`, async () => {
        const tab = await tabReading(reader, await overriddenFile())
        await showPage(tab, 'Screens')
        await settle()
        change(tab)
        await settle()
        await showPage(tab, 'More')
        await settle()

        const saved = await save(tab)

        expect(lookOn(tab.graph, 'More', 'Tag')).toEqual(tag)
        expect(lookOn(saved, 'More', 'Tag')).toEqual(tag)
      })
    }

    test(`one window reading on ${reader}: shows Screens, detaches PipIn in Badge, and saves, the save alone reading More`, async () => {
      const tab = await tabReading(reader, await overriddenFile())
      await showPage(tab, 'Screens')
      await settle()
      detachPipIn.change(tab)
      await settle()

      const saved = await save(tab)

      expect(lookOn(saved, 'More', 'Tag')).toEqual(detachPipIn.tag)
    })
  }
})

/**
 * The window keeps a Tag read before the detach as it was, PipIn still an instance with every
 * change. The save keeps the hide on PipIn, every change inside it and every change to the other
 * two layers: PipIn's layers are saved as new ones, under the keys of the layers of Pip they
 * copied, which the Tag's paths name.
 */
const shownTag = tagWith(
  badgeLayer('PipIn', 'INSTANCE', true),
  badgeLayer('Cap', 'GROUP', true),
  badgeLayer('Box', 'FRAME', true)
)
const savedShownTag = tagWith(
  badgeLayer('PipIn', 'FRAME', true),
  badgeLayer('Cap', 'GROUP', true),
  badgeLayer('Box', 'FRAME', true)
)

describe('a detach inside a component that an instance on a page already shown overrides inside the detached layer', () => {
  for (const reader of READERS) {
    test(`one window reading on ${reader}: shows Screens, detaches PipIn in Badge, and saves`, async () => {
      const tab = await tabReading(reader, await overriddenFile(['Screens']))
      await showPage(tab, 'Screens')
      await settle()
      detachPipInOf(tab)
      await settle()

      const saved = await save(tab)

      expect(lookOn(tab.graph, 'Screens', 'Tag')).toEqual(shownTag)
      expect(lookOn(saved, 'Screens', 'Tag')).toEqual(savedShownTag)
    })

    test(`two windows, Bob reading on ${reader}: Bob shows Screens, Ann joins, shows Parts and detaches PipIn in Badge, and each saves`, async () => {
      const { bob, ann } = await bobAndAnn(reader, await overriddenFile(['Screens']))
      detachPipInOf(ann)
      await settle()

      const bobs = await save(bob)
      const anns = await save(ann)

      expect(lookOn(bob.graph, 'Screens', 'Tag')).toEqual(shownTag)
      expect(lookOn(bobs, 'Screens', 'Tag')).toEqual(savedShownTag)
      expect(lookOn(anns, 'Screens', 'Tag')).toEqual(savedShownTag)
    })
  }
})

/** A stored file holding only Cover. */
async function coverFile(): Promise<Uint8Array> {
  await initCodec()
  return exportFigFile(coverGraph())
}

/**
 * Pip, Badge and the Tags drawn in the tab, so no layer of them has a key in a file yet when PipIn
 * is detached. The save keeps the Tag's changes inside PipIn and loses the hide on it, as for a Tag
 * read after the detach.
 */
describe('a detach inside a component drawn in the same session, which an instance drawn with it overrides inside the detached layer', () => {
  for (const reader of READERS) {
    test(`one window reading on ${reader}: draws Badge and its Tags, changes the Tag on Screens, detaches PipIn in Badge, and saves`, async () => {
      const tab = await tabReading(reader, await coverFile())
      overrideTags(tab, drawBadge(tab.graph), ['Screens'])
      await settle()
      detachPipInOf(tab)
      await settle()

      const saved = await save(tab)

      expect(lookOn(saved, 'Screens', 'Tag')).toEqual(detachedTag)
    })
  }
})
