/**
 * A detach inside a component a tab's reader built, then a page that holds an instance of that
 * component, and a save: the page shows, the save goes through, and the instance holds the
 * component's frame where the detached instance was.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditorStore, type EditorStore } from '@/app/editor/session'

import { parseFigFileViaWorker } from '#core/io/formats/fig/read'
import { releaseFigPopulationWorker } from '#core/kiwi/fig/population/client'

import { cleanups, openRoom, runCleanups, startRelay, until } from '#tests/helpers/collab/cloud'

afterEach(runCleanups)

const READERS = ['the reader worker', 'this thread'] as const
type Reader = (typeof READERS)[number]

/**
 * Cover; Screens with three frames and a Bar; Parts with the bar's component, Progress, whose fill
 * and rest are followed by a Dot instance; and More with another Bar. A tab reads a page only when
 * it shows it, and showing Screens builds Progress.
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
  graph.createNode('RECTANGLE', progress.id, { name: 'Fill', width: 396, height: 8 })
  graph.createNode('RECTANGLE', progress.id, { name: 'Rest', width: 0, height: 8, layoutGrow: 1 })
  const dot = graph.createNode('COMPONENT', parts.id, { name: 'Dot', width: 8, height: 8, y: 300 })
  graph.createNode('ELLIPSE', dot.id, { name: 'Spot', width: 8, height: 8 })
  graph.createInstance(dot.id, progress.id, { name: 'Dot' })
  for (const name of ['One', 'Two', 'Three']) {
    graph.createNode('FRAME', screens.id, { name, width: 40, height: 40 })
  }
  for (const page of [screens, more]) {
    const bar = graph.createInstance(progress.id, page.id, { name: 'Bar', width: 358, y: 100 })
    const [fill, rest] = bar ? graph.getChildren(bar.id) : []
    if (!fill || !rest) throw new Error('Expected the fill and the rest')
    graph.updateNode(fill.id, { width: 90 })
    graph.updateNode(rest.id, { width: 268 })
  }
  return exportFigFile(graph)
}

/** A tab that opened the stored file through a reader worker, as the app does, its first page read. */
async function workerTab(bytes: Uint8Array): Promise<EditorStore> {
  const graph = await parseFigFileViaWorker(Uint8Array.from(bytes).buffer, {
    populate: 'first-page'
  })
  const store = createEditorStore(graph)
  cleanups.push(() => {
    store.preparationController.dispose()
    releaseFigPopulationWorker(graph)
  })
  return store
}

/** A tab whose reader is this thread, its first page shown. */
async function threadTab(bytes: Uint8Array): Promise<EditorStore> {
  const store = createEditorStore(
    await parseFigFile(Uint8Array.from(bytes).buffer, { populate: 'none' })
  )
  cleanups.push(() => store.preparationController.dispose())
  const [first] = store.graph.getPages()
  if (!first) throw new Error('Expected a page')
  await showPage(store, first.name)
  return store
}

const tabReading = (reader: Reader, bytes: Uint8Array) =>
  reader === 'the reader worker' ? workerTab(bytes) : threadTab(bytes)

function pageNamed(graph: SceneGraph, name: string): string {
  const page = graph.getPages().find((candidate) => candidate.name === name)
  if (!page) throw new Error(`Expected a page named ${name}`)
  return page.id
}

/** The editor's own page switch: the app's waits for a canvas to show the page, and a test has none. */
async function showPage(store: EditorStore, name: string) {
  const prepared = await store.preparePage(pageNamed(store.graph, name))
  if (prepared) store.commitPageSwitch(prepared)
}

/** Lets the room carry what the last step sent, both ways. */
async function settle() {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
}

const topLayerCount = (graph: SceneGraph, page: string) =>
  graph.getChildren(pageNamed(graph, page)).length

/** The name and type of each layer of the Bar on a page. */
function barLayers(graph: SceneGraph, page: string): Array<[string, string]> {
  const bar = graph.getChildren(pageNamed(graph, page)).find((node) => node.name === 'Bar')
  if (!bar) throw new Error(`Expected the Bar on ${page}`)
  return graph.getChildren(bar.id).map((node) => [node.name, node.type])
}

/** Detaches, with the editor's own action, the dot in the copy of the bar's component on top. */
function detachDot(tab: EditorStore, rename?: string): void {
  const progresses = tab.graph
    .getChildren(pageNamed(tab.graph, 'Parts'))
    .filter((node) => node.name === 'Progress')
  const top = progresses.at(-1)
  const dot = top && tab.graph.getChildren(top.id).find((node) => node.name === 'Dot')
  if (!dot) throw new Error('Expected the dot in the bar’s component')
  tab.select([dot.id])
  tab.detachInstance()
  if (rename) tab.updateNodeWithUndo(dot.id, { name: rename }, 'Rename')
}

/** Shows More, then saves: the Bar on More as the tab has it, and as the saved file reopens. */
async function showMoreAndSave(tab: EditorStore) {
  await showPage(tab, 'More')
  await settle()
  const saved = await parseFigFile(Uint8Array.from(await exportFigFile(tab.graph)).buffer, {
    populate: 'all'
  })
  return { shown: barLayers(tab.graph, 'More'), saved: barLayers(saved, 'More') }
}

const barWithFrame = (name: string): Array<[string, string]> => [
  ['Fill', 'RECTANGLE'],
  ['Rest', 'RECTANGLE'],
  [name, 'FRAME']
]

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

        const result = await showMoreAndSave(tab)

        expect(result.shown).toEqual(barWithFrame(rename ?? 'Dot'))
        expect(result.saved).toEqual(barWithFrame(rename ?? 'Dot'))
      })
    }

    test(`two windows, Bob reading on ${reader}: Bob shows Screens, Ann joins, shows Parts, detaches and renames the dot in the copy on top, and each shows More and saves`, async () => {
      const relay = await startRelay()
      const documentId = crypto.randomUUID()
      const file = await storedFile()
      const bob = await tabReading(reader, file)
      const bobRoom = openRoom(relay, bob, { documentId, name: 'Bob' })
      await until(() => bobRoom.session.roomHasDocument())
      await showPage(bob, 'Screens')
      await settle()
      const shown = topLayerCount(bob.graph, 'Screens')
      const ann = await threadTab(file)
      const annRoom = openRoom(relay, ann, { documentId, name: 'Ann' })
      await until(() => annRoom.session.hasDocument.value && annRoom.session.peers.value.length > 0)
      await until(() => topLayerCount(ann.graph, 'Screens') >= shown)
      await settle()
      await showPage(ann, 'Parts')
      await settle()
      detachDot(ann, 'Badge')
      await settle()

      // Bob's reader built the copy Ann detached; Ann's own copy may stay beside it on Parts, so
      // her More may keep the dot, and only her page and save are checked.
      const bobs = await showMoreAndSave(bob)
      const anns = await showMoreAndSave(ann)

      expect(bobs.shown).toEqual(barWithFrame('Badge'))
      expect(bobs.saved).toEqual(barWithFrame('Badge'))
      expect(anns.shown.map(([name]) => name)).toContain('Fill')
      expect(anns.saved.map(([name]) => name)).toContain('Fill')
    })
  }
})
