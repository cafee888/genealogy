import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
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
  year: number | "?";
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
      <div className="tree-person-node__year">{personData.year}</div>
      {personData.canExpand && (
        <button
          type="button"
          className="tree-person-node__toggle nodrag"
          onClick={(event) => {
            event.stopPropagation();
            personData.onToggle(id);
          }}
          title={personData.collapsed ? "Expand descendants" : "Collapse descendants"}
        >
          {personData.collapsed ? "+" : "-"}
        </button>
      )}
    </div>
  );
}

function getSortedByBirth(people: Person[]): Person[] {
  return [...people].sort(
    (a, b) => (a.birth.year ?? Number.MAX_SAFE_INTEGER) - (b.birth.year ?? Number.MAX_SAFE_INTEGER)
  );
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

function getDefaultCollapsedIds(people: Person[]): Set<string> {
  const sortedByBirth = getSortedByBirth(people);
  const generationById = getGenerationById(sortedByBirth);
  const expandableIds = getExpandableIds(people);
  const defaults = new Set<string>();

  sortedByBirth.forEach((person) => {
    const generation = generationById.get(person.id) ?? 0;

    // Keep generation 0, 1, and 2 visible by default; collapse deeper descendants.
    if (generation === 2 && expandableIds.has(person.id)) {
      defaults.add(person.id);
    }
  });

  return defaults;
}

function getExpandableIds(people: Person[]): Set<string> {
  const personById = new Map(people.map((person) => [person.id, person]));
  const expandable = new Set<string>();

  people.forEach((person) => {
    const hasExpandableChild = person.children.some((childId) => {
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

function FamilyTree() {
  const people = getAllPeople();
  const navigate = useNavigate();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => getDefaultCollapsedIds(people));
  const [showTopGenerationOnly, setShowTopGenerationOnly] = useState(false);
  const expandableIds = useMemo(() => getExpandableIds(people), [people]);

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

    const childrenById = new Map<string, string[]>();
    sortedByBirth.forEach((person) => {
      childrenById.set(person.id, person.children);
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
          const descendantId = stack.pop();
          if (!descendantId || hiddenNodeIds.has(descendantId)) {
            continue;
          }

          hiddenNodeIds.add(descendantId);
          const descendantChildren = childrenById.get(descendantId) ?? [];
          descendantChildren.forEach((childId) => stack.push(childId));
        }
      });
    }

    const groupedByGeneration = new Map<number, string[]>();
    sortedByBirth.forEach((person) => {
      const generation = generationById.get(person.id) ?? 0;
      const group = groupedByGeneration.get(generation) ?? [];
      group.push(person.id);
      groupedByGeneration.set(generation, group);
    });

    const treeNodes: Node[] = [];

    groupedByGeneration.forEach((ids, generation) => {
      ids.forEach((id, index) => {
        const person = sortedByBirth.find((p) => p.id === id);
        if (!person) {
          return;
        }

        treeNodes.push({
          id: person.id,
          type: "personNode",
          position: { x: 280 * index, y: 180 * generation },
          data: {
            name: person.name,
            chineseName: person.chineseName,
            year: person.birth.year ?? "?",
            canExpand: expandableIds.has(person.id),
            collapsed: collapsedIds.has(person.id),
            onToggle: handleToggleCollapse
          },
          hidden: hiddenNodeIds.has(person.id),
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
      });
    });

    const treeEdges: Edge[] = [];

    people.forEach((person) => {
      person.children.forEach((childId) => {
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
    setShowTopGenerationOnly(true);
    setCollapsedIds(new Set(collapsiblePeopleIds));
  }, [collapsiblePeopleIds]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      navigate(`/person/${node.id}`);
    },
    [navigate]
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="tree-header-row">
          <div>
            <h2>Family Tree View</h2>
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
          onNodeClick={handleNodeClick}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background gap={24} color="#c7d4d8" />
          <Controls />
        </ReactFlow>
      </div>

      <div className="card-grid">
        {people.map((person) => (
          <Link key={person.id} to={`/person/${person.id}`} className="person-card-link">
            <article className="person-card">
              <h3>{person.name}</h3>
              {person.chineseName && <p className="person-card__chinese">{person.chineseName}</p>}
              <p>
                {person.birth.year ?? "?"} - {person.death.year ?? "Present"}
              </p>
            </article>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default FamilyTree;
