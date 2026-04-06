import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const MIN_TREE_ZOOM = 0.2;
const LEVEL3_GENERATION_INDEX = 2;
const TREE_LAYOUT_STORAGE_KEY = "genealogy.tree.layout";

interface PersonNodeData {
  name: string;
  chineseName: string | null;
  yearText: string | null;
  deceased: boolean;
  canExpand: boolean;
  collapsed: boolean;
  onToggle: (id: string) => void;
}

function PersonNode({ id, data }: NodeProps) {
  const personData = data as unknown as PersonNodeData;

  return (
    <div className={`tree-person-node${personData.deceased ? " tree-person-node--deceased" : ""}`}>
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

  if (birthYear === null) {
    if (!person.deceased) {
      return "";
    }

    return deathYear !== null ? `Unknown - ${deathYear}` : "";
  }

  if (!person.deceased) {
    return `${birthYear}`;
  }

  return `${birthYear} - ${deathYear ?? "Unknown"}`;
}

function getCardYearText(person: Person): string {
  const birthYear = extractYear(person.birth.date, person.birth.year);
  const deathYear = extractYear(person.death.date, person.death.year);

  if (!person.deceased) {
    return birthYear !== null ? `${birthYear} - Present` : "";
  }

  if (birthYear !== null && deathYear !== null) {
    return `${birthYear} - ${deathYear}`;
  }

  if (birthYear !== null) {
    return `${birthYear}`;
  }

  if (deathYear !== null) {
    return `${deathYear}`;
  }

  return "";
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
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);
  const [isLeftToRightLayout, setIsLeftToRightLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const savedLayout = window.sessionStorage.getItem(TREE_LAYOUT_STORAGE_KEY);
    if (savedLayout === "left-right") {
      return true;
    }

    if (savedLayout === "top-down") {
      return false;
    }

    return window.matchMedia("(max-width: 900px)").matches;
  });
  const hasCenteredInitiallyRef = useRef(false);
  const defaultCollapsedIds = useMemo(() => getInitialCollapsedIds(people), [people]);
  const personById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const generationById = useMemo(() => getGenerationById(getSortedByBirth(people)), [people]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set(defaultCollapsedIds));
  const [isExpandAllMode, setIsExpandAllMode] = useState(false);
  const [showTopGenerationOnly, setShowTopGenerationOnly] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState("");
  const expandableIds = useMemo(() => getExpandableIds(people), [people]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");

    const hasSavedLayoutPreference = () => {
      const savedLayout = window.sessionStorage.getItem(TREE_LAYOUT_STORAGE_KEY);
      return savedLayout === "left-right" || savedLayout === "top-down";
    };

    const handleChange = (event: MediaQueryListEvent) => {
      if (!hasSavedLayoutPreference()) {
        setIsLeftToRightLayout(event.matches);
      }
    };

    if (!hasSavedLayoutPreference()) {
      setIsLeftToRightLayout(media.matches);
    }

    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    // Recenter after orientation switches between desktop and mobile layouts.
    hasCenteredInitiallyRef.current = false;
  }, [isLeftToRightLayout]);

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

  const handleToggleCollapse = useCallback((personId: string) => {
    setShowTopGenerationOnly(false);
    setIsExpandAllMode(false);
    const wasCollapsed = collapsedIds.has(personId);

    setCollapsedIds((previous) => {
      const next = new Set(previous);
      const isCurrentlyCollapsed = next.has(personId);

      if (!isCurrentlyCollapsed) {
        next.add(personId);
        return next;
      }

      next.delete(personId);

      const generation = generationById.get(personId) ?? 0;
      const shouldAutoCollapseOtherBranches = generation >= LEVEL3_GENERATION_INDEX && !isExpandAllMode;

      if (shouldAutoCollapseOtherBranches) {
        const exemptLevel3Ids = new Set<string>();
        const visited = new Set<string>();
        const stack = [personId];

        while (stack.length > 0) {
          const currentId = stack.pop();
          if (!currentId || visited.has(currentId)) {
            continue;
          }

          visited.add(currentId);

          const currentGeneration = generationById.get(currentId) ?? 0;
          if (currentGeneration === LEVEL3_GENERATION_INDEX) {
            exemptLevel3Ids.add(currentId);
          }

          if (currentGeneration <= LEVEL3_GENERATION_INDEX) {
            continue;
          }

          const currentPerson = personById.get(currentId);
          currentPerson?.parents.forEach((parentId) => {
            stack.push(parentId);
          });
        }

        expandableIds.forEach((expandableId) => {
          if (expandableId === personId) {
            return;
          }

          const expandableGeneration = generationById.get(expandableId) ?? 0;
          if (
            expandableGeneration === LEVEL3_GENERATION_INDEX &&
            !exemptLevel3Ids.has(expandableId)
          ) {
            next.add(expandableId);
          }
        });
      }

      return next;
    });

    if (wasCollapsed) {
      requestAnimationFrame(() => {
        const instance = reactFlowRef.current;
        if (!instance) {
          return;
        }

        const node = instance.getNode(personId);
        if (!node || node.hidden) {
          return;
        }

        const nodeWidth = node.measured?.width ?? node.width ?? 220;
        const nodeHeight = node.measured?.height ?? node.height ?? 92;
        const nodeX = node.position.x;
        const nodeY = node.position.y;

        instance.setCenter(nodeX + nodeWidth / 2, nodeY + nodeHeight / 2, {
          duration: 220,
          zoom: instance.getZoom()
        });
      });
    }
  }, [collapsedIds, expandableIds, generationById, isExpandAllMode, personById]);

  const handleToggleLayout = useCallback(() => {
    setIsLeftToRightLayout((previous) => {
      const next = !previous;
      window.sessionStorage.setItem(TREE_LAYOUT_STORAGE_KEY, next ? "left-right" : "top-down");
      return next;
    });
  }, []);

  const nodeTypes = useMemo(() => ({ personNode: PersonNode }), []);

  const { nodes, edges } = useMemo(() => {
    const sortedByBirth = getSortedByBirth(people);
    const personById = new Map(sortedByBirth.map((person) => [person.id, person]));
    const generationByIdForTree = getGenerationById(sortedByBirth);
    const nodeGapX = 300;
    const nodeWidth = 220;
    const nodeMinGapX = 44;
    const familyGapColumns = 0.55;
    const regularGapColumns = 0.12;
    const branchGroupGapColumns = 1.15;
    const generationStep = isLeftToRightLayout ? 320 : 180;

    const childrenById = getChildrenById(sortedByBirth);
    const spousesById = new Map<string, string[]>();
    sortedByBirth.forEach((person) => {
      spousesById.set(person.id, person.spouses);
    });

    const hiddenNodeIds = new Set<string>();

    if (showTopGenerationOnly) {
      sortedByBirth.forEach((person) => {
        if ((generationByIdForTree.get(person.id) ?? 0) > 0) {
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
      const generation = generationByIdForTree.get(person.id) ?? 0;
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

          const generationPosition = generationStep * generation;
          const position = isLeftToRightLayout
            ? { x: generationPosition, y: finalX }
            : { x: finalX, y: generationPosition };

          treeNodes.push({
            id: person.id,
            type: "personNode",
            position,
            data: {
              name: person.name,
              chineseName: person.chineseName,
              yearText: getNodeYearText(person),
              deceased: person.deceased,
              canExpand: expandableIds.has(person.id),
              collapsed: collapsedIds.has(person.id),
              onToggle: handleToggleCollapse
            },
            hidden,
            className: `tree-person-node-wrap${person.deceased ? " tree-person-node-wrap--deceased" : ""}`,
            style: {
              width: 220,
              padding: 0,
              borderRadius: 16,
              border: person.deceased ? "1px solid #8f9eb0" : "1px solid #5ab8db",
              background: person.deceased
                ? "linear-gradient(160deg, #f1f4f7, #d7e0ea)"
                : "linear-gradient(160deg, #f8fbff, #e1efff)",
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
          sourceHandle: isLeftToRightLayout ? "right" : "bottom",
          target: childId,
          targetHandle: isLeftToRightLayout ? "left" : "top",
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
            sourceHandle: isLeftToRightLayout ? "bottom" : "right",
            target: spouseId,
            targetHandle: isLeftToRightLayout ? "top" : "left",
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
  }, [people, collapsedIds, handleToggleCollapse, showTopGenerationOnly, expandableIds, isLeftToRightLayout]);

  const handleExpandAll = useCallback(() => {
    setShowTopGenerationOnly(false);
    setIsExpandAllMode(true);
    setCollapsedIds(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    setShowTopGenerationOnly(false);
    setIsExpandAllMode(false);
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
      reactFlowRef.current = instance;

      if (hasCenteredInitiallyRef.current) {
        return;
      }

      const visibleNodes = nodes.filter((node) => !node.hidden);
      if (visibleNodes.length === 0) {
        return;
      }

      if (!isLeftToRightLayout) {
        // Desktop default: fit view to generation levels 0-2 ("level 3").
        const level3Nodes = visibleNodes.filter((node) => (generationById.get(node.id) ?? Number.MAX_SAFE_INTEGER) <= 2);
        const targetNodes = level3Nodes.length > 0 ? level3Nodes : visibleNodes;

        instance.fitView({
          nodes: targetNodes.map((node) => ({ id: node.id })),
          duration: 250,
          padding: 0.2,
          minZoom: MIN_TREE_ZOOM
        });

        hasCenteredInitiallyRef.current = true;
        return;
      }

      const groupingAxisValues = isLeftToRightLayout
        ? [...new Set(visibleNodes.map((node) => node.position.x))].sort((a, b) => a - b)
        : [...new Set(visibleNodes.map((node) => node.position.y))].sort((a, b) => a - b);

      const targetAxisValue = groupingAxisValues[1] ?? groupingAxisValues[0];
      const targetBandNodes = visibleNodes.filter((node) =>
        isLeftToRightLayout ? node.position.x === targetAxisValue : node.position.y === targetAxisValue
      );

      const bandMin = Math.min(
        ...targetBandNodes.map((node) => (isLeftToRightLayout ? node.position.y : node.position.x))
      );
      const bandMax = Math.max(
        ...targetBandNodes.map((node) => (isLeftToRightLayout ? node.position.y : node.position.x))
      );

      const targetX = isLeftToRightLayout ? targetAxisValue + 110 : (bandMin + bandMax) / 2 + 110;
      const targetY = isLeftToRightLayout ? (bandMin + bandMax) / 2 + 46 : targetAxisValue + 46;

      instance.setCenter(targetX, targetY, { duration: 250, zoom: MIN_TREE_ZOOM });
      hasCenteredInitiallyRef.current = true;
    },
    [nodes, isLeftToRightLayout, generationById]
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
              Expand all
            </button>
            <button type="button" className="tree-action-btn" onClick={handleCollapseAll}>
              Collapse all
            </button>
            <button type="button" className="tree-action-btn" onClick={handleToggleLayout}>
              Layout: {isLeftToRightLayout ? "Left/Right" : "Top/Down"}
            </button>
          </div>
        </div>
      </div>

      <div className="tree-canvas">
        <ReactFlow
          fitView
          minZoom={MIN_TREE_ZOOM}
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
            <article className={`person-card${person.deceased ? " person-card--deceased" : ""}`}>
              <h3>{person.name}</h3>
              {person.chineseName && <p className="person-card__chinese">{person.chineseName}</p>}
              <p className="person-card__year">{getCardYearText(person)}</p>
            </article>
          </Link>
        ))}
        {filteredPeople.length === 0 && <p className="people-search-empty">No people matched your search.</p>}
      </div>
    </section>
  );
}

export default FamilyTree;
