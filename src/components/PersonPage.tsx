import { Link, useParams } from "react-router-dom";
import LocationTimeline from "./LocationTimeline";
import PhotoGallery from "./PhotoGallery";
import { getPersonById, getPhotosForPerson, getRelatives } from "../utils/genealogy";
import type { Person } from "../types";

function formatLifeEvent(event: { date?: string | null; year: number | null; place: string | null }, fallback: string) {
  const dateOrYear = event.date ?? event.year ?? fallback;
  return `${dateOrYear}${event.place ? `, ${event.place}` : ""}`;
}

function normalizeBioToPresentTense(text: string): string {
  return text
    .replace(/\bwas\b/gi, "is")
    .replace(/\bwere\b/gi, "are")
    .replace(/\bhad\b/gi, "has");
}

function formatDeathEvent(event: { date?: string | null; year: number | null; place: string | null }) {
  if (!event.date && event.year === null && event.place) {
    return `Deceased, ${event.place}`;
  }

  return formatLifeEvent(event, "Unknown");
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

function parseDateLoose(dateOrNull: string | null | undefined): Date | null {
  if (!dateOrNull) {
    return null;
  }

  const iso = dateOrNull.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dmy = dateOrNull.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function calculateAgeAtDeath(person: Person): number | null {
  const birthYear = extractYear(person.birth.date, person.birth.year);
  const deathYear = extractYear(person.death.date, person.death.year);

  if (birthYear === null || deathYear === null) {
    return null;
  }

  const birthDate = parseDateLoose(person.birth.date);
  const deathDate = parseDateLoose(person.death.date);

  if (birthDate && deathDate) {
    let age = deathDate.getFullYear() - birthDate.getFullYear();
    const beforeBirthday =
      deathDate.getMonth() < birthDate.getMonth() ||
      (deathDate.getMonth() === birthDate.getMonth() && deathDate.getDate() < birthDate.getDate());

    if (beforeBirthday) {
      age -= 1;
    }

    return age >= 0 ? age : null;
  }

  const yearAge = deathYear - birthYear;
  return yearAge >= 0 ? yearAge : null;
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
  const ageAtDeath = calculateAgeAtDeath(person);

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
          <strong>Birth:</strong> <span className="multiline-text">{formatLifeEvent(person.birth, "Unknown")}</span>
        </p>
        {hasDeathInfo && (
          <p>
            <strong>Death:</strong> <span className="multiline-text">{formatDeathEvent(person.death)}</span>
          </p>
        )}
        {hasDeathInfo && ageAtDeath !== null && (
          <p>
            <strong>Age at death:</strong> {ageAtDeath}
          </p>
        )}
        {(person.burial.place || person.burial.notes) && (
          <p>
            <strong>Burial:</strong> <span className="multiline-text">{person.burial.place ?? "Unknown"}</span>
            {person.burial.notes ? ` (${person.burial.notes})` : ""}
          </p>
        )}
      </section>

      <section className="profile-section">
        <h3>Bio</h3>
        <p className="multiline-text">{normalizeBioToPresentTense(person.bio)}</p>
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
          <strong>Siblings:</strong>{" "}
          {relatives.siblings.length > 0
            ? relatives.siblings.map((sibling, index) => (
                <span key={sibling.id}>
                  <Link to={`/person/${sibling.id}`} className="text-link">
                    {sibling.name}
                  </Link>
                  {index < relatives.siblings.length - 1 ? ", " : ""}
                </span>
              ))
            : "None listed"}
        </p>
        <p>
          <strong>Children:</strong>{" "}
          {relatives.children.length > 0
            ? relatives.children.map((child, index) => (
                <span key={child.id}>
                  <Link to={`/person/${child.id}`} className="text-link">
                    {child.name}
                  </Link>
                  {index < relatives.children.length - 1 ? ", " : ""}
                </span>
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
        <PhotoGallery photos={photos} personId={person.id} />
      </section>
    </article>
  );
}

export default PersonPage;
