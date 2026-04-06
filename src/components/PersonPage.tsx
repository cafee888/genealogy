import { Link, useParams } from "react-router-dom";
import LocationTimeline from "./LocationTimeline";
import PhotoGallery from "./PhotoGallery";
import { getPersonById, getPhotosForPerson, getRelatives } from "../utils/genealogy";

function formatLifeEvent(event: { date?: string | null; year: number | null; place: string | null }, fallback: string) {
  const dateOrYear = event.date ?? event.year ?? fallback;
  return `${dateOrYear}${event.place ? `, ${event.place}` : ""}`;
}

function PersonPage() {
  const { personId } = useParams();

  if (!personId) {
    return <p className="panel">Missing person ID.</p>;
  }

  const person = getPersonById(personId);

  if (!person) {
    return <p className="panel">Person not found.</p>;
  }

  const relatives = getRelatives(person.id);
  const photos = getPhotosForPerson(person.id);
  const hasDeathInfo = Boolean(person.death.date || person.death.year || person.death.place);

  return (
    <article className="panel person-layout">
      <div className="profile-row">
        <div>
          <h2>{person.name}</h2>
          {person.chineseName && <p className="person-chinese-name">{person.chineseName}</p>}
        </div>
        <Link to="/" className="text-link">
          Back to tree
        </Link>
      </div>

      <section className="profile-section">
        <h3>Profile</h3>
        {person.chineseName && (
          <p>
            <strong>Chinese Name:</strong> {person.chineseName}
          </p>
        )}
        <p>
          <strong>Birth:</strong> {formatLifeEvent(person.birth, "Unknown")}
        </p>
        {hasDeathInfo && (
          <p>
            <strong>Death:</strong> {formatLifeEvent(person.death, "Unknown")}
          </p>
        )}
        {(person.burial.place || person.burial.notes) && (
          <p>
            <strong>Burial:</strong> {person.burial.place ?? "Unknown"}
            {person.burial.notes ? ` (${person.burial.notes})` : ""}
          </p>
        )}
      </section>

      <section className="profile-section">
        <h3>Bio</h3>
        <p>{person.bio}</p>
      </section>

      <section className="profile-section relatives-list">
        <h3>Relatives</h3>
        <p>
          <strong>Parents:</strong>{" "}
          {relatives.parents.length > 0
            ? relatives.parents.map((parent) => (
                <Link key={parent.id} to={`/person/${parent.id}`} className="text-link">
                  {parent.name}
                </Link>
              ))
            : "None listed"}
        </p>
        <p>
          <strong>Spouses:</strong>{" "}
          {relatives.spouses.length > 0
            ? relatives.spouses.map((spouse) => (
                <Link key={spouse.id} to={`/person/${spouse.id}`} className="text-link">
                  {spouse.name}
                </Link>
              ))
            : "None listed"}
        </p>
        <p>
          <strong>Children:</strong>{" "}
          {relatives.children.length > 0
            ? relatives.children.map((child) => (
                <Link key={child.id} to={`/person/${child.id}`} className="text-link">
                  {child.name}
                </Link>
              ))
            : "None listed"}
        </p>
      </section>

      <section className="profile-section">
        <h3>Location Timeline</h3>
        <LocationTimeline locations={person.locations} />
      </section>

      <section className="profile-section">
        <h3>Photo Gallery</h3>
        <PhotoGallery photos={photos} />
      </section>
    </article>
  );
}

export default PersonPage;
