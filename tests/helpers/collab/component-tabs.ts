/**
 * Tabs for the tests of a change inside a component: a tab reading a stored file through a reader
 * worker, as the app does, or on this thread; two windows sharing a room; the editor's own page
 * switch; and layers looked up by name.
 */
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { createEditorStore, type EditorStore } from '@/app/editor/session'

import { parseFigFileViaWorker } from '#core/io/formats/fig/read'
import { releaseFigPopulationWorker } from '#core/kiwi/fig/population/client'

import { cleanups, openRoom, startRelay, until } from '#tests/helpers/collab/cloud'

export const READERS = ['the reader worker', 'this thread'] as const
export type Reader = (typeof READERS)[number]

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

export const tabReading = (reader: Reader, bytes: Uint8Array) =>
  reader === 'the reader worker' ? workerTab(bytes) : threadTab(bytes)

export function pageNamed(graph: SceneGraph, name: string): string {
  const page = graph.getPages().find((candidate) => candidate.name === name)
  if (!page) throw new Error(`Expected a page named ${name}`)
  return page.id
}

/** The editor's own page switch: the app's waits for a canvas to show the page, and a test has none. */
export async function showPage(store: EditorStore, name: string) {
  const prepared = await store.preparePage(pageNamed(store.graph, name))
  if (prepared) store.commitPageSwitch(prepared)
}

/** Lets the room carry what the last step sent, both ways. */
export async function settle() {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
}

const topLayerCount = (graph: SceneGraph, page: string) =>
  graph.getChildren(pageNamed(graph, page)).length

/**
 * Two windows on the stored file in one room: Bob, reading on `reader`, shows Screens; Ann, reading
 * on this thread, joins, and once she holds what Bob shows, shows Parts.
 */
export async function bobAndAnn(reader: Reader, file: Uint8Array) {
  const relay = await startRelay()
  const documentId = crypto.randomUUID()
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
  return { bob, ann }
}

/** The top layer named `name` on a page, the last one where a page holds several. */
export function topLayer(graph: SceneGraph, page: string, name: string): SceneNode {
  const node = graph
    .getChildren(pageNamed(graph, page))
    .findLast((candidate) => candidate.name === name)
  if (!node) throw new Error(`Expected ${name} on ${page}`)
  return node
}

export function childNamed(graph: SceneGraph, parentId: string, name: string): SceneNode {
  const child = graph.getChildren(parentId).find((node) => node.name === name)
  if (!child) throw new Error(`Expected ${name}`)
  return child
}

/** A layer of the component named `component` on Parts, in its copy on top. */
export const inComponent = (tab: EditorStore, component: string, name: string): SceneNode =>
  childNamed(tab.graph, topLayer(tab.graph, 'Parts', component).id, name)

/** The saved file of the tab's graph, reopened whole. */
export async function save(tab: EditorStore): Promise<SceneGraph> {
  return parseFigFile(Uint8Array.from(await exportFigFile(tab.graph)).buffer, { populate: 'all' })
}
