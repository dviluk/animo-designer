import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'
import { recordInstanceOverride } from '@open-pencil/scene-graph/instances'
import { copiedComponentLayerId } from '@open-pencil/scene-graph/instances/overrides'
import { expectDefined } from '@open-pencil/test-support/assert'

test('undoing a detach gives the instances it held back the overrides they had', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const tag = editor.graph.createNode('COMPONENT', page, { name: 'Tag' })
  editor.graph.createNode('TEXT', tag.id, { name: 'Label', text: 'Tag' })
  const card = editor.graph.createNode('COMPONENT', page, { name: 'Card' })
  const nested = editor.graph.createInstance(tag.id, card.id)
  if (!nested) throw new Error('No nested tag')
  const [nestedLabel] = editor.graph.getChildren(nested.id)
  editor.graph.updateNode(nestedLabel.id, { text: 'Práctica guiada' })
  recordInstanceOverride(editor.graph, nestedLabel.id, ['text'])
  const instance = editor.graph.createInstance(card.id, page)
  if (!instance) throw new Error('No instance')
  const [tagCopy] = editor.graph.getChildren(instance.id)
  const [label] = editor.graph.getChildren(tagCopy.id)
  const overriddenLayers = () => [
    ...(editor.graph.getNode(tagCopy.id)?.instanceOverrides.descendants.keys() ?? [])
  ]
  const copied = overriddenLayers()

  editor.select([instance.id])
  editor.detachInstance()
  expect(overriddenLayers()).toEqual([label.id])

  editor.undoAction()
  expect(editor.graph.getNode(instance.id)?.type).toBe('INSTANCE')
  expect(overriddenLayers()).toEqual(copied)

  editor.redoAction()
  expect(editor.graph.getNode(instance.id)?.type).toBe('FRAME')
  expect(overriddenLayers()).toEqual([label.id])
})

test('an instance a detached instance held copies its layers from its own component, and copies to the clipboard', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const pip = graph.createNode('COMPONENT', page, { name: 'Pip', width: 40, height: 20 })
  graph.createNode('ELLIPSE', pip.id, { name: 'Core', width: 8, height: 8 })
  const badge = graph.createNode('COMPONENT', page, {
    name: 'Badge',
    width: 150,
    height: 20,
    y: 100
  })
  expectDefined(graph.createInstance(pip.id, badge.id, { name: 'PipIn' }))
  const rack = graph.createNode('COMPONENT', page, { name: 'Rack', width: 150, height: 20, y: 200 })
  expectDefined(graph.createInstance(badge.id, rack.id, { name: 'BadgeIn' }))
  // Opened from a file, each instance records the layer of its own component every layer copies.
  const editor = createEditor({
    graph: await parseFigFile((await exportFigFile(graph)).slice().buffer)
  })
  const child = (parentId: string, name: string) =>
    expectDefined(
      editor.graph.getChildren(parentId).find((node) => node.name === name),
      name
    )
  const named = (name: string) =>
    expectDefined(
      [...editor.graph.getAllNodes()].find((node) => node.name === name),
      name
    )
  const badgeIn = child(named('Rack').id, 'BadgeIn')

  editor.select([badgeIn.id])
  editor.detachInstance()

  const held = child(badgeIn.id, 'PipIn')
  editor.select([held.id])
  expect((await editor.prepareCopy()).html).not.toBe('')
  const core = child(held.id, 'Core')
  expect(copiedComponentLayerId(held.instanceOverrides, held.id, core)).toBe(
    child(named('Pip').id, 'Core').id
  )
})
