import type { DerivedSymbolOverride } from '#fig/instance-overrides/types'

import type { GUID } from '@open-pencil/kiwi/fig'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { findInstanceAncestor } from '@open-pencil/scene-graph/instances'
import {
  copiedComponentLayerId,
  getInstanceOverride
} from '@open-pencil/scene-graph/instances/overrides'
import { ownsSlotContent } from '@open-pencil/scene-graph/slots'

type ResolveGuid = (id: string) => GUID | undefined

/**
 * For each copy built before a detach that an instance's addresses pass through, the layer each
 * layer in it names (`staleCopyNames`). The addresses of one instance's claims share one, and those
 * of its geometry another, so each such copy is walked once for each.
 */
export type StaleCopies = Map<string, ReadonlyMap<string, string | undefined>>

export function instanceExportAddress(
  graph: SceneGraph,
  owner: SceneNode,
  target: SceneNode,
  resolveGuid: ResolveGuid,
  stale: StaleCopies = new Map()
): GUID[] | undefined {
  if (target.id === owner.id && owner.componentId) {
    const guid = resolveGuid(owner.componentId)
    return guid ? [guid] : undefined
  }
  const boundaries: SceneNode[] = []
  let parent = target.parentId ? graph.getNode(target.parentId) : undefined
  while (parent && parent.id !== owner.id) {
    if (parent.type === 'INSTANCE') boundaries.unshift(parent)
    parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
  }
  if (!parent) return undefined
  const path: GUID[] = []
  let scope = owner
  let detached: SceneNode | undefined
  for (const node of [...boundaries, target]) {
    const sourceId = detached
      ? staleCopyNames(graph, scope, detached, stale).get(node.id)
      : definitionSource(graph, sourceOf(scope, node))
    if (!sourceId) return undefined
    const guid = resolveGuid(sourceId)
    if (!guid) return undefined
    path.push(guid)
    const source = graph.getNode(sourceId)
    detached = source?.type === 'INSTANCE' ? undefined : source
    scope = node
  }
  return path
}

/**
 * The layer each layer of `copy` names in a save, by its id, where `copy` is a copy built before
 * `detached`, its source, was detached: each layer it holds, down to each instance inside it. A
 * layer the copy built then names a layer of the old component, which the saved file no longer
 * holds, so it names the detached layer's own layer linked to that one instead. It keeps the old
 * name where none is linked, or where another layer of the copy names that one itself, as a layer
 * the sync added after the detach does: two layers with one address make the save fail.
 */
function staleCopyNames(
  graph: SceneGraph,
  copy: SceneNode,
  detached: SceneNode,
  stale: StaleCopies
): ReadonlyMap<string, string | undefined> {
  const known = stale.get(copy.id)
  if (known) return known
  const copied = new Map<string, string | undefined>()
  const visit = (parentId: string): void => {
    for (const child of graph.getChildren(parentId)) {
      copied.set(child.id, definitionSource(graph, sourceOf(copy, child)))
      if (child.type !== 'INSTANCE') visit(child.id)
    }
  }
  visit(copy.id)
  const linked = keptLinks(graph, detached)
  const taken = new Set(copied.values())
  const names = new Map<string, string | undefined>()
  for (const [id, source] of copied) {
    const own = source === undefined ? undefined : linked.get(source)
    if (own !== undefined && !taken.has(own)) {
      taken.add(own)
      names.set(id, own)
    } else names.set(id, source)
  }
  stale.set(copy.id, names)
  return names
}

/**
 * The detached layer's own layers, by the layer of the old component each kept the link to
 * (`copiedLayerLinks`, `packages/scene-graph/src/instances/index.ts`). A layer made after the detach
 * has no link. Two layers linked to one source give it none, so neither takes the other's changes.
 */
function keptLinks(graph: SceneGraph, detached: SceneNode): Map<string, string | undefined> {
  const linked = new Map<string, string | undefined>()
  const visit = (parentId: string): void => {
    for (const child of graph.getChildren(parentId)) {
      const link = getInstanceOverride(
        detached.instanceOverrides,
        detached.id,
        child.id,
        'sourceComponentId'
      )
      if (typeof link === 'string') linked.set(link, linked.has(link) ? undefined : child.id)
      if (child.type !== 'INSTANCE') visit(child.id)
    }
  }
  visit(detached.id)
  return linked
}

function sourceOf(scope: SceneNode, node: SceneNode): string | null {
  return copiedComponentLayerId(scope.instanceOverrides, scope.id, node) ?? null
}

/**
 * Only definition-level nodes are written as records, so a path segment must name one.
 * A source that itself sits inside an instance (a nested instance's child as seen from the
 * enclosing component) resolves through its own correspondence until it leaves every instance.
 */
function definitionSource(graph: SceneGraph, id: string | null): string | undefined {
  const seen = new Set<string>()
  let current = id ? graph.getNode(id) : undefined
  while (current) {
    const owner = current.parentId ? findInstanceAncestor(graph, current.parentId) : undefined
    if (!owner) return current.id
    if (seen.has(current.id)) return undefined
    seen.add(current.id)
    const next = sourceOf(owner, current)
    current = next ? graph.getNode(next) : undefined
  }
  return undefined
}

/** Derived geometry is a snapshot, not an authored size or position claim. */
export function snapshotInstanceGeometry(
  graph: SceneGraph,
  owner: SceneNode,
  resolveGuid: ResolveGuid,
  retained: DerivedSymbolOverride[],
  geometry: (node: SceneNode) => Pick<DerivedSymbolOverride, 'size' | 'transform'>
): DerivedSymbolOverride[] {
  const key = (path: GUID[]) => path.map((guid) => `${guid.sessionID}:${guid.localID}`).join('/')
  const entries = new Map<string, DerivedSymbolOverride>()
  const unaddressed: DerivedSymbolOverride[] = []
  for (const entry of retained) {
    if (!entry.guidPath?.guids?.length) {
      unaddressed.push(entry)
      continue
    }
    const id = key(entry.guidPath.guids)
    entries.set(id, { ...entries.get(id), ...entry })
  }
  const visited = new Set<string>()
  const stale: StaleCopies = new Map()
  const visit = (node: SceneNode): void => {
    for (const child of graph.getChildren(node.id)) {
      const path = instanceExportAddress(graph, owner, child, resolveGuid, stale)
      if (!path)
        throw new Error(`Missing instance geometry address for ${child.id} under ${owner.id}`)
      const id = key(path)
      if (visited.has(id))
        throw new Error(`Ambiguous instance geometry address ${id} under ${owner.id}`)
      visited.add(id)
      entries.set(id, { ...entries.get(id), guidPath: { guids: path }, ...geometry(child) })
      // Slot content the instance owns is written as its own records, not as derived data.
      if (!ownsSlotContent(graph, child)) visit(child)
    }
  }
  visit(owner)
  return [...unaddressed, ...entries.values()]
}
