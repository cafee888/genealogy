import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getAllPeople } from "../utils/genealogy";

function FamilyTree() {
  const people = getAllPeople();

  const { nodes, edges } = useMemo(() => {
    const sortedByBirth = [...people].sort(
      (a, b) => (a.birth.year ?? Number.MAX_SAFE_INTEGER) - (b.birth.year ?? Number.MAX_SAFE_INTEGER)
    );

    const generationById = new Map<string, number>();

    const computeGeneration = (id: string): number => {
      if (generationById.has(id)) {
        return generationById.get(id)!;
      }

      const person = sortedByBirth.find((p) => p.id === id);
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
          position: { x: 280 * index, y: 180 * generation },
          data: {
            label: `${person.name}\n${person.birth.year ?? "?"}`
          },
          style: {
            width: 220,
            whiteSpace: "pre-line",
            borderRadius: 16,
            border: "1px solid #0f5d6f",
            background: "#fef6e9"
          }
        });
      });
    });

    const treeEdges: Edge[] = [];

    people.forEach((person) => {
      person.children.forEach((childId) => {
        treeEdges.push({
          id: `${person.id}-${childId}`,
          source: person.id,
          target: childId,
          markerEnd: { type: MarkerType.ArrowClosed },
          animated: false,
          style: { stroke: "#2a6f97", strokeWidth: 2 }
        });
      });

      person.spouses.forEach((spouseId) => {
        if (person.id < spouseId) {
          treeEdges.push({
            id: `spouse-${person.id}-${spouseId}`,
            source: person.id,
            target: spouseId,
            type: "straight",
            style: { stroke: "#7a2848", strokeDasharray: "6 4", strokeWidth: 2 }
          });
        }
      });
    });

    return { nodes: treeNodes, edges: treeEdges };
  }, [people]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Family Tree View</h2>
        <p>Click any person card below the graph for profile details.</p>
      </div>

      <div className="tree-canvas">
        <ReactFlow fitView nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false}>
          <Background gap={24} color="#c7d4d8" />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </div>

      <div className="card-grid">
        {people.map((person) => (
          <Link key={person.id} to={`/person/${person.id}`} className="person-card-link">
            <article className="person-card">
              <h3>{person.name}</h3>
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
