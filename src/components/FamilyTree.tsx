import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  type NodeProps,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getAllPeople } from "../utils/genealogy";
import type { Person } from "../types";

interface PersonNodeData {
  name: string;
  chineseName: string | null;
  yearText: string | null;
  canExpand: boolean;
  collapsed: boolean;
  onToggle: (id: string) => void;
}

function PersonNode({ id, data }: NodeProps) {
  const personData = data as unknown as PersonNodeData;

  return (
    <div className="tree-person-node">
      <Handle type="target" position={Position.Top} id="top" className="tree-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="tree-handle" />
      <Handle type="target" position={Position.Left} id="left" className="tree-handle" />
      <Handle type="source" position={Position.Right} id="right" className="tree-handle" />
      <div className="tree-person-node__name">{personData.name}</div>
      {personData.chineseName && <div className="tree-person-node__chinese">{personData.chineseName}</div>}
      {personData.yearText && <div className="tree-person-node__year">{personData.yearText}</div>}
      {personData.canExpand && (
        <button
          type="button"
          className="tree-person-node__toggle nodrag"
          onClick={(event) => {
            event.stopPropagation();
            personData.onToggle(id);
          }}
          title={personData.collapsed ? "Expand descendants" : "Collapse descendants"}
          aria-label={personData.collapsed ? "Expand descendants" : "Collapse descendants"}
        >
          {personData.collapsed ? "▸" : "▾"}
        </button>
      )}
    </div>
  );
}

function getSortedByBirth(people: Person[]): Person[] {
  return [...people];
}

function getGenerationById(sortedByBirth: Person[]): Map<string, number> {
  const generationById = new Map<string, number>();

  const personById = new Map(sortedByBirth.map((person) => [person.id, person]));

  const computeGeneration = (id: string): number => {
    if (generationById.has(id)) {
      return generationById.get(id)!;
    }

    const person = personById.get(id);
    if (!person || person.parents.length === 0) {
      generationById.set(id, 0);
      return 0;
    }

    const parentGenerations = person.parents.map((parentId) => computeGeneration(parentId));
    const generation = Math.max(...parentGenerations) + 1;
    generationById.set(id, generation);
    return generation;
  };

  sortedByBirth.forEach((person) => {
    computeGeneration(person.id);
  });

  // Keep spouses in the same generation when one side has incomplete parent records.
  let changed = true;
  while (changed) {
    changed = false;

    sortedByBirth.forEach((person) => {
      const current = generationById.get(person.id) ?? 0;

      person.spouses.forEach((spouseId) => {
        const spouseGeneration = generationById.get(spouseId);
        if (spouseGeneration === undefined) {
          return;
        }

        const target = Math.max(current, spouseGeneration);

        if (current !== target) {
          generationById.set(person.id, target);
          changed = true;
        }

        if (spouseGeneration !== target) {
          generationById.set(spouseId, target);
          changed = true;
        }
      });
    });
  }

  return generationById;
}

function getChildrenById(people: Person[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();

  people.forEach((person) => {
    map.set(person.id, new Set(person.children));
  });

  people.forEach((child) => {
    child.parents.forEach((parentId) => {
      const parentChildren = map.get(parentId) ?? new Set<string>();
      parentChildren.add(child.id);
      map.set(parentId, parentChildren);
    });
  });

  const normalized = new Map<string, string[]>();
  map.forEach((children, parentId) => {
    normalized.set(parentId, [...children]);
  });

  return normalized;
}

function extractYear(dateOrNull: string | null | undefined, yearOrNull: number | null): number | null {
  if (yearOrNull !== null) {
    return yearOrNull;
  }

  if (!dateOrNull) {
    return null;
  }

  const match = dateOrNull.match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

function getNodeYearText(person: Person): string {
  const birthYear = extractYear(person.birth.date, person.birth.year);
  const deathYear = extractYear(person.death.date, person.death.year);
  const hasDeathInfo = Boolean(person.death.date || person.death.year || person.death.place);

  if (birthYear === null) {
    return "";
  }

  if (!hasDeathInfo) {
    return `${birthYear}`;
  }

  return `${birthYear} - ${deathYear ?? "Unknown"}`;
}

function getCardYearText(person: Person): string {
  const birthYear = extractYear(person.birth.date, person.birth.year);
  const deathYear = extractYear(person.death.date, person.death.year);
  const hasDeathInfo = Boolean(person.death.date || person.death.year || person.death.place);

  if (!hasDeathInfo) {
    return `${birthYear ?? "Unknown"}`;
  }

  if (deathYear !== null) {
    return `${birthYear ?? "Unknown"} - ${deathYear}`;
  }

  return `${birthYear ?? "Unknown"} - Deceased`;
}

function getExpandableIds(people: Person[]): Set<string> {
  const personById = new Map(people.map((person) => [person.id, person]));
  const childrenById = getChildrenById(people);
  const expandable = new Set<string>();

  people.forEach((person) => {
    const childIds = childrenById.get(person.id) ?? [];

    const hasExpandableChild = childIds.some((childId) => {
      const child = personById.get(childId);
      if (!child || child.parents.length === 0) {
        return true;
      }

      // Use the first parent as the branch owner so couple controls appear on one side only.
      return child.parents[0] === person.id;
    });

    if (hasExpandableChild) {
      expandable.add(person.id);
    }
  });

  return expandable;
}

function getInitialCollapsedIds(people: Person[]): Set<string> {
  const sortedByBirth = getSortedByBirth(people);
  const generationById = getGenerationById(sortedByBirth);
  const expandableIds = getExpandableIds(people);
  const initialCollapsed = new Set<string>();

  sortedByBirth.forEach((person) => {
    const generation = generationById.get(person.id) ?? 0;

    // Keep the first 3 generations visible (0, 1, 2) and collapse deeper branches by default.
    if (generation === 2 && expandableIds.has(person.id)) {
      initialCollapsed.add(person.id);
    }
  });

  return initialCollapsed;
}

function FamilyTree() {
  const people = getAllPeople();
  const navigate = useNavigate();
  const hasCenteredInitiallyRef = useRef(false);
  const defaultCollapsedIds = useMemo(() => getInitialCollapsedIds(people), [people]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set(defaultCollapsedIds));
  const [showTopGenerationOnly, setShowTopGenerationOnly] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState("");
  const expandableIds = useMemo(() => getExpandableIds(people), [people]);

  const filteredPeople = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    if (!query) {
      return people;
    }

    return people.filter((person) => {
      const name = person.name.toLowerCase();
      const chineseName = (person.chineseName ?? "").toLowerCase();
      return name.includes(query) || chineseName.includes(query);
    });
  }, [people, peopleSearch]);

  const collapsiblePeopleIds = useMemo(
    () => [...expandableIds],
    [expandableIds]
  );

  const handleToggleCollapse = useCallback((personId: string) => {
    setShowTopGenerationOnly(false);
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  }, []);

  const nodeTypes = useMemo(() => ({ personNode: PersonNode }), []);

  const { nodes, edges } = useMemo(() => {
    const sortedByBirth = getSortedByBirth(people);
    const personById = new Map(sortedByBirth.map((person) => [person.id, person]));
    const generationById = getGenerationById(sortedByBirth);
    const nodeGapX = 300;
    const nodeWidth = 220;
    const nodeMinGapX = 44;
    const familyGapColumns = 0.55;
    const regularGapColumns = 0.12;
    const branchGroupGapColumns = 1.15;

    const childrenById = getChildrenById(sortedByBirth);
    const spousesById = new Map<string, string[]>();
    sortedByBirth.forEach((person) => {
      spousesById.set(person.id, person.spouses);
    });

    const hiddenNodeIds = new Set<string>();

    if (showTopGenerationOnly) {
      sortedByBirth.forEach((person) => {
        if ((generationById.get(person.id) ?? 0) > 0) {
          hiddenNodeIds.add(person.id);
        }
      });
    } else {
      collapsedIds.forEach((collapsedId) => {
        const stack = [...(childrenById.get(collapsedId) ?? [])];
        while (stack.length > 0) {
          const branchPersonId = stack.pop();
          if (!branchPersonId || hiddenNodeIds.has(branchPersonId)) {
            continue;
          }

          hiddenNodeIds.add(branchPersonId);

          // Keep a collapsed branch coherent by hiding spouses tied to hidden descendants.
          const spouseIds = spousesById.get(branchPersonId) ?? [];
          spouseIds.forEach((spouseId) => {
            if (!hiddenNodeIds.has(spouseId)) {
              stack.push(spouseId);
            }
          });

          const descendantChildren = childrenById.get(branchPersonId) ?? [];
          descendantChildren.forEach((childId) => stack.push(childId));
        }
      });
    }

    const primaryChildrenById = new Map<string, string[]>();
    childrenById.forEach((childIds, parentId) => {
      const primaryChildren = childIds.filter((childId) => {
        const child = personById.get(childId);
        return !child || child.parents.length === 0 || child.parents[0] === parentId;
      });
      primaryChildrenById.set(parentId, primaryChildren);
    });

    const visibleSpanCache = new Map<string, number>();
    const getVisibleBranchSpan = (personId: string): number => {
      if (visibleSpanCache.has(personId)) {
        return visibleSpanCache.get(personId)!;
      }

      if (hiddenNodeIds.has(personId)) {
        visibleSpanCache.set(personId, 0);
        return 0;
      }

      const visiblePrimaryChildren = (primaryChildrenById.get(personId) ?? []).filter(
        (childId) => !hiddenNodeIds.has(childId)
      );

      if (visiblePrimaryChildren.length === 0) {
        visibleSpanCache.set(personId, 1);
        return 1;
      }

      const span = Math.max(
        1,
        visiblePrimaryChildren.reduce((sum, childId) => sum + Math.max(1, getVisibleBranchSpan(childId)), 0)
      );

      visibleSpanCache.set(personId, span);
      return span;
    };

    const groupedByGeneration = new Map<number, string[]>();
    sortedByBirth.forEach((person) => {
      const generation = generationById.get(person.id) ?? 0;
      const group = groupedByGeneration.get(generation) ?? [];
      group.push(person.id);
      groupedByGeneration.set(generation, group);
    });

    const fileOrderIndex = new Map<string, number>();
    sortedByBirth.forEach((person, index) => {
      fileOrderIndex.set(person.id, index);
    });

    const treeNodes: Node[] = [];
    const positionedXById = new Map<string, number>();

    [...groupedByGeneration.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([generation, ids]) => {
      const generationSet = new Set(ids);
      const placed = new Set<string>();
      let cursor = 0;
      let lastParentGroupKey: string | null = null;
      let nextFreeX = 0;

      const orderedIds = [...ids].sort((aId, bId) => {
        const a = personById.get(aId);
        const b = personById.get(bId);

        const aPrimaryParent = a?.parents?.[0];
        const bPrimaryParent = b?.parents?.[0];

        const aParentX = aPrimaryParent ? positionedXById.get(aPrimaryParent) : undefined;
        const bParentX = bPrimaryParent ? positionedXById.get(bPrimaryParent) : undefined;

        if (aParentX !== undefined && bParentX !== undefined && aParentX !== bParentX) {
          return aParentX - bParentX;
        }

        if (aParentX !== undefined && bParentX === undefined) {
          return -1;
        }

        if (aParentX === undefined && bParentX !== undefined) {
          return 1;
        }

        return (fileOrderIndex.get(aId) ?? 0) - (fileOrderIndex.get(bId) ?? 0);
      });

      const siblingIdsByParent = new Map<string, string[]>();
      orderedIds.forEach((id) => {
        const person = personById.get(id);
        const primaryParentId = person?.parents?.[0];
        if (!primaryParentId || !positionedXById.has(primaryParentId)) {
          return;
        }

        const siblings = siblingIdsByParent.get(primaryParentId) ?? [];
        siblings.push(id);
        siblingIdsByParent.set(primaryParentId, siblings);
      });

      const reserveVisibleX = (desiredX: number) => {
        const x = Math.max(desiredX, nextFreeX);
        nextFreeX = x + nodeWidth + nodeMinGapX;
        return x;
      };

      const pushNode = (person: Person, x: number, hidden: boolean, reserveSpace: boolean) => {
        const finalX = !hidden && reserveSpace ? reserveVisibleX(x) : x;
        positionedXById.set(person.id, finalX);

        treeNodes.push({
          id: person.id,
          type: "personNode",
          position: { x: finalX, y: 180 * generation },
          data: {
            name: person.name,
            chineseName: person.chineseName,
            yearText: getNodeYearText(person),
            canExpand: expandableIds.has(person.id),
            collapsed: collapsedIds.has(person.id),
            onToggle: handleToggleCollapse
          },
          hidden,
          className: "tree-person-node-wrap",
          style: {
            width: 220,
            padding: 0,
            borderRadius: 16,
            border: "1px solid #5ab8db",
            background: "linear-gradient(160deg, #f8fbff, #e1efff)",
            boxShadow: "0 8px 22px rgba(5, 15, 26, 0.25)"
          }
        });
      };

      const getDesiredCenterX = (person: Person): number | null => {
        const parentXs = person.parents
          .map((parentId) => positionedXById.get(parentId))
          .filter((x): x is number => x !== undefined);

        if (parentXs.length === 0) {
          return null;
        }

        const sum = parentXs.reduce((acc, x) => acc + x, 0);
        return sum / parentXs.length;
      };

      const getDesiredChildSlotX = (person: Person): number | null => {
        const primaryParentId = person.parents[0];
        if (!primaryParentId) {
          return null;
        }

        const parentX = positionedXById.get(primaryParentId);
        const siblingIds = siblingIdsByParent.get(primaryParentId);

        if (parentX === undefined || !siblingIds || siblingIds.length === 0) {
          return null;
        }

        const index = siblingIds.indexOf(person.id);
        if (index < 0) {
          return null;
        }

        const offset = index - (siblingIds.length - 1) / 2;
        return parentX + offset * nodeGapX * 0.9;
      };

      orderedIds.forEach((id) => {
        if (placed.has(id)) {
          return;
        }

        const person = personById.get(id);
        if (!person) {
          return;
        }

        const parentGroupKey = person.parents[0] ?? `root:${person.id}`;
        const personHidden = hiddenNodeIds.has(person.id);

        if (!personHidden && lastParentGroupKey !== null && parentGroupKey !== lastParentGroupKey) {
          const rowBranchGap = generation === 0 ? branchGroupGapColumns : 0.25;
          cursor += rowBranchGap;
        }

        const spouseId = person.spouses.find((spouse) => generationSet.has(spouse) && !placed.has(spouse));
        const spouse = spouseId ? personById.get(spouseId) : undefined;
        const spouseHidden = spouse ? hiddenNodeIds.has(spouse.id) : true;

        const hasVisiblePrimaryChildren = (primaryChildrenById.get(person.id) ?? []).some(
          (childId) => !hiddenNodeIds.has(childId)
        );

        if (!personHidden && spouse && !spouseHidden) {
          // Keep couples adjacent, then reserve extra columns for descendant branches.
          const personDesired = getDesiredChildSlotX(person) ?? getDesiredCenterX(person);
          const spouseDesired = getDesiredChildSlotX(spouse) ?? getDesiredCenterX(spouse);
          const desiredCenter = personDesired ?? spouseDesired ?? null;
          const minLeftX = cursor * nodeGapX;
          const leftX = Math.max(minLeftX, desiredCenter !== null ? desiredCenter - nodeGapX / 2 : minLeftX);

          const placedLeftX = reserveVisibleX(leftX);
          pushNode(person, placedLeftX, false, false);
          pushNode(spouse, placedLeftX + nodeGapX, false, true);

          const personSpan = Math.max(1, getVisibleBranchSpan(person.id));
          const reservedColumns = Math.max(2, personSpan);
          const gapAfter = hasVisiblePrimaryChildren ? familyGapColumns : regularGapColumns;

          cursor = Math.max(cursor, placedLeftX / nodeGapX + reservedColumns + gapAfter);
          lastParentGroupKey = parentGroupKey;
          placed.add(person.id);
          placed.add(spouse.id);
          return;
        }

        const span = personHidden ? 0 : Math.max(1, getVisibleBranchSpan(person.id));
        const minCenterX = (cursor + (span - 1) / 2) * nodeGapX;
        const desiredCenterX = getDesiredChildSlotX(person) ?? getDesiredCenterX(person);
        const x = personHidden
          ? 0
          : generation === 0
            ? Math.max(minCenterX, desiredCenterX ?? minCenterX)
            : (desiredCenterX ?? minCenterX);
        pushNode(person, x, personHidden, true);

        if (!personHidden) {
          const gapAfter = hasVisiblePrimaryChildren ? familyGapColumns : regularGapColumns;
          const placedX = positionedXById.get(person.id) ?? x;
          const leftCol = placedX / nodeGapX - (span - 1) / 2;
          cursor = Math.max(cursor, leftCol + span + gapAfter);
          lastParentGroupKey = parentGroupKey;
        }

        if (spouse) {
          pushNode(spouse, 0, spouseHidden, false);
          placed.add(spouse.id);
        }

        placed.add(person.id);
      });
    });

    const treeEdges: Edge[] = [];

    people.forEach((person) => {
      const childIds = childrenById.get(person.id) ?? [];

      childIds.forEach((childId) => {
        const child = personById.get(childId);
        const isPrimaryParent = !child || child.parents.length === 0 || child.parents[0] === person.id;

        if (!isPrimaryParent) {
          return;
        }

        treeEdges.push({
          id: `${person.id}-${childId}`,
          source: person.id,
          sourceHandle: "bottom",
          target: childId,
          targetHandle: "top",
          type: "step",
          className: "parent-link",
          hidden: hiddenNodeIds.has(person.id) || hiddenNodeIds.has(childId),
          markerEnd: { type: MarkerType.ArrowClosed, color: "#5dd6ff" },
          animated: true,
          style: { stroke: "#5dd6ff", strokeWidth: 2.9 }
        });
      });

      person.spouses.forEach((spouseId) => {
        if (person.id < spouseId) {
          treeEdges.push({
            id: `spouse-${person.id}-${spouseId}`,
            source: person.id,
            sourceHandle: "right",
            target: spouseId,
            targetHandle: "left",
            className: "spouse-link",
            hidden: hiddenNodeIds.has(person.id) || hiddenNodeIds.has(spouseId),
            type: "straight",
            animated: true,
            style: { stroke: "#ff6fae", strokeDasharray: "8 5", strokeWidth: 3.1 }
          });
        }
      });
    });

    return { nodes: treeNodes, edges: treeEdges };
  }, [people, collapsedIds, handleToggleCollapse, showTopGenerationOnly, expandableIds]);

  const handleExpandAll = useCallback(() => {
    setShowTopGenerationOnly(false);
    setCollapsedIds(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    setShowTopGenerationOnly(false);
    setCollapsedIds(new Set(defaultCollapsedIds));
  }, [defaultCollapsedIds]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      navigate(`/person/${node.id}`);
    },
    [navigate]
  );

  const handleFlowInit = useCallback(
    (instance: ReactFlowInstance) => {
      if (hasCenteredInitiallyRef.current) {
        return;
      }

      const visibleNodes = nodes.filter((node) => !node.hidden);
      if (visibleNodes.length === 0) {
        return;
      }

      const minY = Math.min(...visibleNodes.map((node) => node.position.y));
      const topNodes = visibleNodes.filter((node) => node.position.y === minY);

      const targetNode = [...topNodes].sort((a, b) => a.position.x - b.position.x)[0];
      const targetX = targetNode.position.x + 110;
      const targetY = targetNode.position.y + 46;

      instance.setCenter(targetX, targetY, { duration: 250, zoom: 1 });
      hasCenteredInitiallyRef.current = true;
    },
    [nodes]
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="tree-header-row">
          <div>
            <h2>Family Tree</h2>
            <p>Click any person card below the graph for profile details.</p>
          </div>
          <div className="tree-actions">
            <button type="button" className="tree-action-btn" onClick={handleExpandAll}>
              Open all
            </button>
            <button type="button" className="tree-action-btn" onClick={handleCollapseAll}>
              Collapse all
            </button>
          </div>
        </div>
      </div>

      <div className="tree-canvas">
        <ReactFlow
          fitView
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={handleFlowInit}
          onNodeClick={handleNodeClick}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background gap={24} color="#c7d4d8" />
          <Controls />
        </ReactFlow>
      </div>

      <div className="people-search-row">
        <label htmlFor="people-search" className="people-search-label">
          Search people
        </label>
        <input
          id="people-search"
          className="people-search-input"
          type="search"
          placeholder="Search by name or Chinese name"
          value={peopleSearch}
          onChange={(event) => setPeopleSearch(event.target.value)}
        />
      </div>

      <div className="card-grid">
        {filteredPeople.map((person) => (
          <Link key={person.id} to={`/person/${person.id}`} className="person-card-link">
            <article className="person-card">
              <h3>{person.name}</h3>
              {person.chineseName && <p className="person-card__chinese">{person.chineseName}</p>}
              <p>{getCardYearText(person)}</p>
            </article>
          </Link>
        ))}
        {filteredPeople.length === 0 && <p className="people-search-empty">No people matched your search.</p>}
      </div>
    </section>
  );
}

export default FamilyTree;
