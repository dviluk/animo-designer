/**
 * What an instance changed on a layer of its component, and inside it, when that layer's type
 * changes in place or it is deleted. An instance on a page not yet shown loses those changes, and
 * keeps what it changed on the component's other layers. An instance read before a detach keeps
 * what it changed on the detached layer and inside it, in the window and across a reopen, in one
 * window and in two; one drawn in the same session keeps what it changed inside it.
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

describe('a change inside a component that an instance on a page not yet shown overrides, on the changed layer and inside it', () => {
  const detachPipIn = {
    steps: 'detaches PipIn',
    change: detachPipInOf,
    tag: tagWith(
      badgeLayer('PipIn', 'FRAME', false),
      badgeLayer('Cap', 'GROUP', true),
      badgeLayer('Box', 'FRAME', true)
    )
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
 * two layers: its paths name PipIn's own layers, which copy the layers of Pip the Tag changed.
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

/**
 * Badge and its Tags (`drawBadge`), with Rack, a component on Parts holding BadgeIn, an instance of
 * Badge; and on Screens Slot, an instance of Rack, which hides each of Badge's three layers inside
 * BadgeIn, fills the shape inside each red and changes its text.
 */
async function rackedFile(): Promise<Uint8Array> {
  await initCodec()
  const graph = coverGraph()
  drawBadge(graph)
  const rack = graph.createNode('COMPONENT', pageNamed(graph, 'Parts'), {
    name: 'Rack',
    width: 150,
    height: 20,
    y: 200
  })
  graph.createInstance(topLayer(graph, 'Parts', 'Badge').id, rack.id, { name: 'BadgeIn' })
  const slot = graph.createInstance(rack.id, pageNamed(graph, 'Screens'), { name: 'Slot', y: 100 })
  if (!slot) throw new Error('Expected the Slot')
  const author = createEditorStore(graph)
  overrideTags(author, new Map([['Screens', childNamed(graph, slot.id, 'BadgeIn')]]), ['Screens'])
  await settle()
  const bytes = await exportFigFile(graph)
  author.preparationController.dispose()
  return bytes
}

/** The Slot, its BadgeIn of `type` with every change the Slot made inside it. */
const changedSlot = (type: string): Look => ({
  name: 'Slot',
  type: 'INSTANCE',
  visible: true,
  children: [
    {
      name: 'BadgeIn',
      type,
      visible: true,
      children: [
        badgeLayer('PipIn', 'INSTANCE', true),
        badgeLayer('Cap', 'GROUP', true),
        badgeLayer('Box', 'FRAME', true)
      ]
    }
  ]
})

/** Detaches, with the editor's own action, BadgeIn in the copy of Rack on top. */
function detachBadgeInOf(tab: EditorStore): void {
  tab.select([inComponent(tab, 'Rack', 'BadgeIn').id])
  tab.detachInstance()
}

/**
 * BadgeIn's detach leaves PipIn an instance of Pip that Rack holds itself. The Slot read before the
 * detach keeps across the save what it changed on PipIn and inside it, as on the other two layers.
 */
describe('a detach inside a component of an instance holding an instance, which an instance on a page already shown overrides inside both', () => {
  for (const reader of READERS) {
    test(`one window reading on ${reader}: shows Screens, detaches BadgeIn in Rack, and saves`, async () => {
      const tab = await tabReading(reader, await rackedFile())
      await showPage(tab, 'Screens')
      await settle()
      detachBadgeInOf(tab)
      await settle()

      const saved = await save(tab)

      expect(lookOn(tab.graph, 'Screens', 'Slot')).toEqual(changedSlot('INSTANCE'))
      expect(lookOn(saved, 'Screens', 'Slot')).toEqual(changedSlot('FRAME'))
    })

    test(`two windows, Bob reading on ${reader}: Bob shows Screens, Ann joins, shows Parts and detaches BadgeIn in Rack, and each saves`, async () => {
      const { bob, ann } = await bobAndAnn(reader, await rackedFile())
      detachBadgeInOf(ann)
      await settle()

      const bobs = await save(bob)
      const anns = await save(ann)

      expect(lookOn(bob.graph, 'Screens', 'Slot')).toEqual(changedSlot('INSTANCE'))
      expect(lookOn(bobs, 'Screens', 'Slot')).toEqual(changedSlot('FRAME'))
      expect(lookOn(anns, 'Screens', 'Slot')).toEqual(changedSlot('FRAME'))
    })
  }
})

/** A stored file holding only Cover. */
async function coverFile(): Promise<Uint8Array> {
  await initCodec()
  return exportFigFile(coverGraph())
}

/**
 * A Tag drawn in the same session after PipIn's detach: PipIn as Badge's frame, with every change
 * inside it and on the other two layers, and without the hide on PipIn, which a layer whose type
 * changed loses.
 */
const detachedTag = tagWith(
  { ...badgeLayer('PipIn', 'FRAME', true), visible: true },
  badgeLayer('Cap', 'GROUP', true),
  badgeLayer('Box', 'FRAME', true)
)

/**
 * Pip, Badge and the Tags drawn in the tab, so no layer of them has a key in a file yet when PipIn
 * is detached. The window syncs such a Tag, so the save keeps its changes inside PipIn.
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
