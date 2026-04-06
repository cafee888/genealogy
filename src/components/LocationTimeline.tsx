import type { LocationEvent } from "../types";

interface LocationTimelineProps {
  locations: LocationEvent[];
}

function LocationTimeline({ locations }: LocationTimelineProps) {
  const sortedLocations = [...locations].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

  return (
    <ul className="timeline-list">
      {sortedLocations.map((location, index) => (
        <li key={`${location.place}-${index}`}>
          <strong>{location.year ?? "Unknown"}</strong> - {location.place} ({location.type})
        </li>
      ))}
    </ul>
  );
}

export default LocationTimeline;
