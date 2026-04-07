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

interface ExportNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: PersonNodeData;
}

function getNodeSize(node: Node): { width: number; height: number } {
  const data = node.data as unknown as PersonNodeData;
  const estimatedNameLines = Math.max(1, Math.min(2, Math.ceil((data.name?.length ?? 0) / 14)));
  const estimatedHeight = 36 + estimatedNameLines * 23 + (data.chineseName ? 24 : 0) + (data.yearText ? 24 : 0);

  return {
    width: node.measured?.width ?? node.width ?? 220,
    height: Math.max(node.measured?.height ?? node.height ?? 92, estimatedHeight)
  };
}

function getHandlePoint(node: ExportNode, handle: string): { x: number; y: number } {
  const { width, height } = node;

  switch (handle) {
    case "top":
      return { x: node.x + width / 2, y: node.y };
    case "bottom":
      return { x: node.x + width / 2, y: node.y + height };
    case "left":
      return { x: node.x, y: node.y + height / 2 };
    case "right":
    default:
      return { x: node.x + width, y: node.y + height / 2 };
  }
}

function buildExportNodes(nodes: Node[], edges: Edge[], isLeftToRightLayout: boolean): ExportNode[] {
  const minGap = 72;
  const bandTolerance = 26;
  const generationGap = 140;
  const globalMargin = 26;
  const byBand = new Map<number, ExportNode[]>();

  const exportNodes = nodes.map((node) => {
    const size = getNodeSize(node);
    const data = node.data as unknown as PersonNodeData;

    return {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
      data
    };
  });

  exportNodes.forEach((node) => {
    const bandAxis = isLeftToRightLayout ? node.x : node.y;
    const bandKey = Math.round(bandAxis / bandTolerance);
    const bucket = byBand.get(bandKey) ?? [];
    bucket.push(node);
    byBand.set(bandKey, bucket);
  });

  const orderedBands = [...byBand.entries()].sort((a, b) => {
    const aAvg = a[1].reduce((sum, node) => sum + (isLeftToRightLayout ? node.x : node.y), 0) / a[1].length;
    const bAvg = b[1].reduce((sum, node) => sum + (isLeftToRightLayout ? node.x : node.y), 0) / b[1].length;
    return aAvg - bAvg;
  });

  const bandIndexByNodeId = new Map<string, number>();
  let nextBandAxisStart: number | null = null;

  orderedBands.forEach(([, bandNodes], bandIndex) => {
    const originalBandAxis =
      bandNodes.reduce((sum, node) => sum + (isLeftToRightLayout ? node.x : node.y), 0) / bandNodes.length;
    const bandAxisStart =
      nextBandAxisStart === null ? originalBandAxis : Math.max(originalBandAxis, nextBandAxisStart);

    const maxBandCrossSize = Math.max(
      ...bandNodes.map((node) => (isLeftToRightLayout ? node.width : node.height))
    );

    bandNodes.forEach((node) => {
      bandIndexByNodeId.set(node.id, bandIndex);
      if (isLeftToRightLayout) {
        node.x = bandAxisStart;
      } else {
        node.y = bandAxisStart;
      }
    });

    nextBandAxisStart = bandAxisStart + maxBandCrossSize + generationGap;
  });

  // Row 3 adjustment: center each node over its child group to improve readability.
  if (orderedBands.length >= 4) {
    const thirdBand = orderedBands[2][1];
    const exportNodeById = new Map(exportNodes.map((node) => [node.id, node]));
    const childIdsByParent = new Map<string, string[]>();

    edges.forEach((edge) => {
      const isSpouseLink = edge.className?.includes("spouse-link") ?? false;
      if (isSpouseLink) {
        return;
      }

      const parentBand = bandIndexByNodeId.get(edge.source);
      const childBand = bandIndexByNodeId.get(edge.target);
      if (parentBand !== 2 || childBand === undefined || childBand <= parentBand) {
        return;
      }

      const children = childIdsByParent.get(edge.source) ?? [];
      children.push(edge.target);
      childIdsByParent.set(edge.source, children);
    });

    const planned = thirdBand
      .map((node) => {
        const childIds = childIdsByParent.get(node.id) ?? [];
        if (childIds.length === 0) {
          return { node, desired: isLeftToRightLayout ? node.y : node.x };
        }

        const childCenters = childIds
          .map((childId) => exportNodeById.get(childId))
          .filter((child): child is ExportNode => !!child)
          .map((child) => (isLeftToRightLayout ? child.y + child.height / 2 : child.x + child.width / 2));

        if (childCenters.length === 0) {
          return { node, desired: isLeftToRightLayout ? node.y : node.x };
        }

        const avgChildCenter = childCenters.reduce((sum, value) => sum + value, 0) / childCenters.length;
        const desiredStart = isLeftToRightLayout
          ? avgChildCenter - node.height / 2
          : avgChildCenter - node.width / 2;

        return { node, desired: desiredStart };
      })
      .sort((a, b) => a.desired - b.desired);

    let nextStart = Number.NEGATIVE_INFINITY;
    planned.forEach(({ node, desired }) => {
      const span = isLeftToRightLayout ? node.height : node.width;
      const adjusted = Math.max(desired, nextStart);

      if (isLeftToRightLayout) {
        node.y = adjusted;
      } else {
        node.x = adjusted;
      }

      nextStart = adjusted + span + minGap;
    });
  }

  byBand.forEach((bandNodes) => {
    bandNodes.sort((a, b) => {
      const aSecondary = isLeftToRightLayout ? a.y : a.x;
      const bSecondary = isLeftToRightLayout ? b.y : b.x;
      return aSecondary - bSecondary;
    });

    let nextStart = Number.NEGATIVE_INFINITY;

    bandNodes.forEach((node) => {
      const secondaryStart = isLeftToRightLayout ? node.y : node.x;
      const secondarySize = isLeftToRightLayout ? node.height : node.width;
      const adjustedStart = Math.max(secondaryStart, nextStart);

      if (isLeftToRightLayout) {
        node.y = adjustedStart;
      } else {
        node.x = adjustedStart;
      }

      nextStart = adjustedStart + secondarySize + minGap;
    });
  });

  const overlaps = (a: ExportNode, b: ExportNode, margin: number): boolean => {
    return !(
      a.x + a.width + margin <= b.x ||
      b.x + b.width + margin <= a.x ||
      a.y + a.height + margin <= b.y ||
      b.y + b.height + margin <= a.y
    );
  };

  // Final pass: resolve any remaining rectangle collisions across all bands.
  const sorted = [...exportNodes].sort((a, b) => {
    const aPrimary = isLeftToRightLayout ? a.x : a.y;
    const bPrimary = isLeftToRightLayout ? b.x : b.y;
    if (aPrimary !== bPrimary) {
      return aPrimary - bPrimary;
    }

    const aSecondary = isLeftToRightLayout ? a.y : a.x;
    const bSecondary = isLeftToRightLayout ? b.y : b.x;
    return aSecondary - bSecondary;
  });

  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;

    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const left = sorted[i];
        const right = sorted[j];

        if (!overlaps(left, right, globalMargin)) {
          continue;
        }

        if (isLeftToRightLayout) {
          const push = left.y + left.height + globalMargin - right.y;
          right.y += Math.max(push, 0);
        } else {
          const push = left.x + left.width + globalMargin - right.x;
          right.x += Math.max(push, 0);
        }

        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  return exportNodes;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let current = tokens[0];

  for (let index = 1; index < tokens.length; index += 1) {
    const next = `${current} ${tokens[index]}`;
    if (context.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = tokens[index];
    }
  }

  lines.push(current);
  return lines;
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
  const [isExportingImage, setIsExportingImage] = useState(false);
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
      const aliasName = (person.aliasName ?? "").toLowerCase();
      const chineseName = (person.chineseName ?? "").toLowerCase();
      return name.includes(query) || aliasName.includes(query) || chineseName.includes(query);
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

  const handleExportImage = useCallback(async () => {
    if (isExportingImage) {
      return;
    }

    const instance = reactFlowRef.current;
    if (!instance) {
      return;
    }

    const imageWindow = window.open("", "genealogy-tree-image-viewer");
    if (!imageWindow) {
      return;
    }

    const loadingDoc = imageWindow.document;
    loadingDoc.title = "Family Tree Image";
    loadingDoc.body.innerHTML = "";
    loadingDoc.body.style.margin = "0";
    loadingDoc.body.style.display = "grid";
    loadingDoc.body.style.placeItems = "center";
    loadingDoc.body.style.minHeight = "100vh";
    loadingDoc.body.style.background = "#ffffff";
    loadingDoc.body.style.color = "#1f3b58";
    loadingDoc.body.style.fontFamily = "'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    loadingDoc.body.textContent = "Rendering image...";

    const previousCollapsedIds = new Set(collapsedIds);
    const previousExpandAllMode = isExpandAllMode;
    const previousTopGenerationOnly = showTopGenerationOnly;

    setIsExportingImage(true);

    try {
      // Capture the complete graph by temporarily expanding all branches.
      setShowTopGenerationOnly(false);
      setIsExpandAllMode(true);
      setCollapsedIds(new Set());

      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 120);
      });

      // When the new tab takes focus, rAF in the source tab can stall.
      // Use bounded timeout polling instead of frame callbacks.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const hasHiddenNodes = instance.getNodes().some((node) => node.hidden);
        if (!hasHiddenNodes) {
          break;
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), 80);
        });
      }

      const visibleNodes = instance.getNodes().filter((node) => !node.hidden);
      if (visibleNodes.length === 0) {
        throw new Error("No visible nodes to render.");
      }

      const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
      const visibleEdges = instance
        .getEdges()
        .filter((edge) => !edge.hidden && visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
      const exportNodes = buildExportNodes(visibleNodes, visibleEdges, isLeftToRightLayout);
      const nodeById = new Map(exportNodes.map((node) => [node.id, node]));
      let dataUrl = "";

      const minX = Math.min(...exportNodes.map((node) => node.x));
      const minY = Math.min(...exportNodes.map((node) => node.y));
      const maxX = Math.max(...exportNodes.map((node) => node.x + node.width));
      const maxY = Math.max(...exportNodes.map((node) => node.y + node.height));

      const padding = 92;
      const logicalWidth = Math.max(1280, Math.ceil(maxX - minX + padding * 2));
      const logicalHeight = Math.max(900, Math.ceil(maxY - minY + padding * 2));
      const pixelRatio = 2;

      const canvas = document.createElement("canvas");
      canvas.width = logicalWidth * pixelRatio;
      canvas.height = logicalHeight * pixelRatio;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Unable to initialize canvas context.");
      }

      context.scale(pixelRatio, pixelRatio);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, logicalWidth, logicalHeight);
      context.translate(-minX + padding, -minY + padding);

      visibleEdges.forEach((edge) => {
          const sourceNode = nodeById.get(edge.source);
          const targetNode = nodeById.get(edge.target);
          if (!sourceNode || !targetNode) {
            return;
          }

          const sourcePoint = getHandlePoint(sourceNode, edge.sourceHandle ?? "bottom");
          const targetPoint = getHandlePoint(targetNode, edge.targetHandle ?? "top");
          const isSpouse = edge.className?.includes("spouse-link") ?? false;

          context.save();
          context.strokeStyle = isSpouse ? "#ff6fae" : "#1395cb";
          context.lineWidth = isSpouse ? 3 : 2.8;
          context.setLineDash(isSpouse ? [10, 6] : []);
          context.lineCap = "round";
          context.lineJoin = "round";
          context.beginPath();

          const dx = targetPoint.x - sourcePoint.x;
          const dy = targetPoint.y - sourcePoint.y;
          const distance = Math.hypot(dx, dy) || 1;
          const unitPerpX = -dy / distance;
          const unitPerpY = dx / distance;

          let control1X = sourcePoint.x + dx * 0.3;
          let control1Y = sourcePoint.y + dy * 0.15;
          let control2X = sourcePoint.x + dx * 0.7;
          let control2Y = sourcePoint.y + dy * 0.85;

          if (edge.type === "step") {
            const sourceIsVertical = (edge.sourceHandle ?? "bottom") === "top" || (edge.sourceHandle ?? "bottom") === "bottom";
            const targetIsVertical = (edge.targetHandle ?? "top") === "top" || (edge.targetHandle ?? "top") === "bottom";

            if (sourceIsVertical && targetIsVertical) {
              // Parent links in top-down layout: exit and enter with vertical tangents.
              const verticalSpan = Math.max(36, Math.abs(dy) * 0.45);
              const sourceDirection = (edge.sourceHandle ?? "bottom") === "top" ? -1 : 1;
              const targetDirection = (edge.targetHandle ?? "top") === "bottom" ? 1 : -1;
              control1X = sourcePoint.x;
              control1Y = sourcePoint.y + sourceDirection * verticalSpan;
              control2X = targetPoint.x;
              control2Y = targetPoint.y + targetDirection * verticalSpan;
            } else if (Math.abs(dx) >= Math.abs(dy)) {
              const bend = Math.min(120, Math.max(42, Math.abs(dx) * 0.22));
              control1X = sourcePoint.x + dx * 0.42;
              control1Y = sourcePoint.y;
              control2X = targetPoint.x - dx * 0.42;
              control2Y = targetPoint.y;
              control1Y += unitPerpY * bend * 0.25;
              control2Y += unitPerpY * bend * 0.25;
            } else {
              const bend = Math.min(120, Math.max(42, Math.abs(dy) * 0.22));
              control1X = sourcePoint.x;
              control1Y = sourcePoint.y + dy * 0.42;
              control2X = targetPoint.x;
              control2Y = targetPoint.y - dy * 0.42;
              control1X += unitPerpX * bend * 0.25;
              control2X += unitPerpX * bend * 0.25;
            }
          } else {
            const spouseBend = Math.min(56, Math.max(18, distance * 0.18));
            control1Y += unitPerpY * spouseBend;
            control1X += unitPerpX * spouseBend;
            control2Y += unitPerpY * spouseBend;
            control2X += unitPerpX * spouseBend;
          }

          context.moveTo(sourcePoint.x, sourcePoint.y);
          context.bezierCurveTo(control1X, control1Y, control2X, control2Y, targetPoint.x, targetPoint.y);

          context.stroke();

          if (!isSpouse) {
            const arrowLength = 11;
            const arrowHalfWidth = 5.5;
            const tangentX = targetPoint.x - control2X;
            const tangentY = targetPoint.y - control2Y;
            const magnitude = Math.hypot(tangentX, tangentY) || 1;
            const ux = tangentX / magnitude;
            const uy = tangentY / magnitude;

            const baseX = targetPoint.x - ux * arrowLength;
            const baseY = targetPoint.y - uy * arrowLength;
            const perpX = -uy;
            const perpY = ux;

            context.fillStyle = "#1395cb";
            context.beginPath();
            context.moveTo(targetPoint.x, targetPoint.y);
            context.lineTo(baseX + perpX * arrowHalfWidth, baseY + perpY * arrowHalfWidth);
            context.lineTo(baseX - perpX * arrowHalfWidth, baseY - perpY * arrowHalfWidth);
            context.closePath();
            context.fill();
          }

          context.restore();
        });

      exportNodes.forEach((node) => {
          const data = node.data;
          const { width, height } = node;
          const x = node.x;
          const y = node.y;

          context.save();
          context.shadowColor = "rgba(0, 0, 0, 0.16)";
          context.shadowBlur = 14;
          context.shadowOffsetY = 4;

          drawRoundedRect(context, x, y, width, height, 16);
          context.fillStyle = data.deceased ? "#eef3f8" : "#eff7ff";
          context.fill();
          context.shadowColor = "transparent";

          drawRoundedRect(context, x, y, width, height, 16);
          context.strokeStyle = data.deceased ? "#9daebf" : "#5ab8db";
          context.lineWidth = 1.4;
          context.stroke();

          context.textAlign = "center";

          context.fillStyle = data.deceased ? "#34475b" : "#11263a";
          context.font = "700 20px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
          const nameLines = wrapText(context, data.name, width - 22).slice(0, 2);
          const nameLineHeight = 23;
          nameLines.forEach((line, lineIndex) => {
            context.fillText(line, x + width / 2, y + 32 + lineIndex * nameLineHeight);
          });

          let infoY = y + 32 + nameLines.length * nameLineHeight;

          if (data.chineseName) {
            context.fillStyle = "#2d4c67";
            context.font = "600 17px 'Noto Serif SC', 'Times New Roman', serif";
            context.fillText(data.chineseName, x + width / 2, infoY);
            infoY += 24;
          }

          if (data.yearText) {
            context.fillStyle = "#1f3b58";
            context.font = "700 17px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
            context.fillText(data.yearText, x + width / 2, infoY);
          }

          context.restore();
        });

      dataUrl = canvas.toDataURL("image/png");

      if (imageWindow) {
        const documentRef = imageWindow.document;
        documentRef.title = "Family Tree Image";
        documentRef.body.innerHTML = "";

        const viewportMeta = documentRef.createElement("meta");
        viewportMeta.name = "viewport";
        viewportMeta.content = "width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes";
        documentRef.head.appendChild(viewportMeta);

        documentRef.documentElement.style.height = "100%";
        documentRef.body.style.margin = "0";
        documentRef.body.style.height = "100%";
        documentRef.body.style.background = "#ffffff";
        documentRef.body.style.overflow = "hidden";

        const viewer = documentRef.createElement("div");
        viewer.style.position = "fixed";
        viewer.style.inset = "0";
        viewer.style.overflow = "auto";
        viewer.style.touchAction = "pan-x pan-y pinch-zoom";
        viewer.style.setProperty("-webkit-overflow-scrolling", "touch");
        viewer.style.padding = "24px";
        viewer.style.display = "grid";
        viewer.style.placeItems = "center";
        viewer.style.minHeight = "100%";

        const preview = documentRef.createElement("img");
        preview.src = dataUrl;
        preview.alt = "Family tree";
        preview.style.display = "block";
        preview.style.width = "auto";
        preview.style.height = "auto";
        preview.style.maxWidth = "calc(100vw - 48px)";
        preview.style.maxHeight = "calc(100vh - 48px)";
        preview.style.objectFit = "contain";
        preview.style.margin = "0 auto";
        preview.style.boxShadow = "0 10px 28px rgba(12, 20, 32, 0.16)";

        const actionBar = documentRef.createElement("div");
        actionBar.style.position = "fixed";
        actionBar.style.top = "14px";
        actionBar.style.right = "14px";
        actionBar.style.zIndex = "20";
        actionBar.style.display = "flex";
        actionBar.style.gap = "10px";

        const styleActionButton = (button: HTMLButtonElement) => {
          button.style.border = "1px solid #0d7ec0";
          button.style.borderRadius = "10px";
          button.style.background = "#ffffff";
          button.style.color = "#0d5f93";
          button.style.fontFamily = "'Plus Jakarta Sans', 'Segoe UI', sans-serif";
          button.style.fontWeight = "700";
          button.style.fontSize = "14px";
          button.style.padding = "9px 13px";
          button.style.cursor = "pointer";
          button.style.boxShadow = "0 6px 18px rgba(9, 27, 43, 0.22)";
        };

        const saveButton = documentRef.createElement("button");
        saveButton.type = "button";
        saveButton.textContent = "Save";
        styleActionButton(saveButton);
        saveButton.onclick = () => {
          const link = documentRef.createElement("a");
          link.href = dataUrl;
          link.download = `family-tree-${new Date().toISOString().slice(0, 10)}.png`;
          link.click();
        };

        const returnButton = documentRef.createElement("button");
        returnButton.type = "button";
        returnButton.textContent = "Return";
        styleActionButton(returnButton);
        returnButton.onclick = () => {
          if (imageWindow.opener && !imageWindow.opener.closed) {
            imageWindow.opener.focus();
          }
          imageWindow.close();
        };

        viewer.appendChild(preview);
        actionBar.appendChild(returnButton);
        actionBar.appendChild(saveButton);
        documentRef.body.appendChild(viewer);
        documentRef.body.appendChild(actionBar);
      }
    } catch (error) {
      console.error("Unable to export family tree image", error);

      const message = error instanceof Error ? error.message : "Unexpected rendering error.";
      const errorDoc = imageWindow.document;
      errorDoc.title = "Family Tree Image - Error";
      errorDoc.body.innerHTML = "";
      errorDoc.body.style.margin = "0";
      errorDoc.body.style.display = "grid";
      errorDoc.body.style.placeItems = "center";
      errorDoc.body.style.minHeight = "100vh";
      errorDoc.body.style.background = "#ffffff";
      errorDoc.body.style.fontFamily = "'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      errorDoc.body.style.color = "#8a1028";

      const errorBox = errorDoc.createElement("div");
      errorBox.style.maxWidth = "620px";
      errorBox.style.padding = "18px 20px";
      errorBox.style.border = "1px solid #f0b7c1";
      errorBox.style.borderRadius = "12px";
      errorBox.style.background = "#fff7f9";
      errorBox.style.boxShadow = "0 8px 20px rgba(120, 18, 38, 0.08)";
      errorBox.innerHTML = `<strong>Image render failed.</strong><div style="margin-top:8px; color:#7b2236;">${message}</div>`;

      errorDoc.body.appendChild(errorBox);
    } finally {
      setCollapsedIds(previousCollapsedIds);
      setIsExpandAllMode(previousExpandAllMode);
      setShowTopGenerationOnly(previousTopGenerationOnly);
      setIsExportingImage(false);
    }
  }, [collapsedIds, isExpandAllMode, showTopGenerationOnly, isExportingImage, isLeftToRightLayout]);

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
            <button
              type="button"
              className="tree-action-btn"
              onClick={() => void handleExportImage()}
              disabled={isExportingImage}
            >
              {isExportingImage ? "Rendering..." : "Image"}
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
          placeholder="Search by name, alias, or Chinese name"
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
