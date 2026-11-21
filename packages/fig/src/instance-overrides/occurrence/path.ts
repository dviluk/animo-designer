import type { GUID } from '@open-pencil/kiwi/fig'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

import { sameGuid } from '../source-index'
import { descendants, findWithinBoundary, type TreeShape } from '../tree'
import type { InstanceOccurrence, InstancePathDiagnostic } from './types'

export const OCCURRENCE_TREE: TreeShape<InstanceOccurrence> = {
  childrenOf: (node) => node.children,
  isInstance: (node) => node.mainComponentId !== null
}

/** Every occurrence below and including `root`, including those inside nested instances. */
export function occurrences(root: InstanceOccurrence): Generator<InstanceOccurrence> {
  return descendants(root, (node) => node.children)
}

export class InstancePathError extends Error {
  constructor(
    readonly diagnostic: InstancePathDiagnostic,
    message: string
  ) {
    super(message)
    this.name = 'InstancePathError'
  }
}

export class SegmentError extends Error {
  constructor(
    readonly count: number,
    guid: GUID
  ) {
    super(`Expected one instance-path target for ${guidToString(guid)}; found ${count}`)
    this.name = 'SegmentError'
  }
}

export function pathError(
  ownerId: string,
  mainComponentId: string | null,
  path: readonly GUID[],
  cause: SegmentError
): InstancePathError {
  return new InstancePathError(
    {
      ownerId,
      mainComponentId,
      path: structuredClone(path),
      reason: cause.count === 0 ? 'missing-target' : 'ambiguous-target'
    },
    `Override declared by ${ownerId}, path [${path.map(guidToString).join(', ')}]: ${cause.message}`
  )
}

function namesSegment(guid: GUID): (node: InstanceOccurrence) => boolean {
  const id = guidToString(guid)
  return (node) => sameGuid(node.overrideKey, guid) || node.sourceId === id
}

/** Search through ordinary containers, but never cross an instance boundary implicitly. */
export function findSegment(root: InstanceOccurrence, guid: GUID): InstanceOccurrence {
  const { count, match } = findWithinBoundary(root.children, OCCURRENCE_TREE, namesSegment(guid))
  if (!match) throw new SegmentError(count, guid)
  return match
}

export function isRootGuid(owner: InstanceOccurrence, guid: GUID): boolean {
  return (
    sameGuid(owner.properties.symbolData?.symbolID, guid) ||
    sameGuid(owner.mainComponentOverrideKey, guid) ||
    sameGuid(owner.sourceComponentOverrideKey, guid) ||
    sameGuid(owner.sourceComponentId, guid)
  )
}

export function resolveOccurrencePath(
  owner: InstanceOccurrence,
  path: readonly GUID[]
): InstanceOccurrence {
  let target = owner
  for (const [index, guid] of path.entries()) {
    if (index === 0 && isRootGuid(owner, guid)) continue
    target = findSegment(target, guid)
  }
  return target
}

/**
 * The copies a page load's reconcile left out of the instances it builds, by the occurrence that
 * held each.
 */
export type LeftOutCopies = Map<InstanceOccurrence, InstanceOccurrence[]>

/**
 * Whether a path `resolveOccurrencePath` finds no target for reaches a left-out copy, the copy
 * itself or a layer inside it: its first missing segment names one of those copies, searched as a
 * segment is, and every segment after it resolves inside that copy.
 */
export function reachesLeftOutCopy(
  owner: InstanceOccurrence,
  path: readonly GUID[],
  leftOut: LeftOutCopies
): boolean {
  let searched = owner
  let inLeftOutCopy = false
  for (const [index, guid] of path.entries()) {
    if (index === 0 && isRootGuid(owner, guid)) continue
    const matches = namesSegment(guid)
    let found = findWithinBoundary(searched.children, OCCURRENCE_TREE, matches)
    if (found.count === 0 && !inLeftOutCopy) {
      found = findWithinBoundary(leftOutWithin(searched, leftOut), OCCURRENCE_TREE, matches)
      inLeftOutCopy = found.count === 1
    }
    if (!found.match) return false
    searched = found.match
  }
  return inLeftOutCopy
}

/** The copies left out of `scope` and of the ordinary layers below it that a segment searches. */
function leftOutWithin(scope: InstanceOccurrence, leftOut: LeftOutCopies): InstanceOccurrence[] {
  return [
    ...(leftOut.get(scope) ?? []),
    ...scope.children.flatMap((child) =>
      OCCURRENCE_TREE.isInstance(child) ? [] : leftOutWithin(child, leftOut)
    )
  ]
}
