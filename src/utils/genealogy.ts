import peopleData from "../data/people.json";
import photosData from "../data/photos.json";
import type { Person, Photo } from "../types";

function normalizePerson(raw: Partial<Person> & { id: string; name: string }): Person {
  const inferredDeceased = Boolean(raw.death?.date || raw.death?.year || raw.death?.place);

  return {
    id: raw.id,
    name: raw.name,
    aliasName: raw.aliasName ?? null,
    chineseName: raw.chineseName ?? null,
    gender: raw.gender === "female" ? "female" : "male",
    deceased: raw.deceased ?? inferredDeceased,
    birth: {
      date: raw.birth?.date ?? null,
      year: raw.birth?.year ?? null,
      place: raw.birth?.place ?? null
    },
    death: {
      date: raw.death?.date ?? null,
      year: raw.death?.year ?? null,
      place: raw.death?.place ?? null
    },
    parents: raw.parents ?? [],
    spouses: raw.spouses ?? [],
    children: raw.children ?? [],
    locations: raw.locations ?? [],
    burial: {
      place: raw.burial?.place ?? null,
      notes: raw.burial?.notes ?? null
    },
    bio: raw.bio ?? ""
  };
}

const people = (peopleData as Array<Partial<Person> & { id: string; name: string }>).map(normalizePerson);
const photos = photosData as Photo[];
const peopleById = new Map(people.map((person) => [person.id, person]));

export function getAllPeople(): Person[] {
  return people;
}

export function getAllPhotos(): Photo[] {
  return photos;
}

export function getPersonById(id: string): Person | undefined {
  return peopleById.get(id);
}

export function getPhotosForPerson(personId: string): Photo[] {
  return photos.filter((photo) => photo.people.includes(personId));
}

export function resolveAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const encodedPath = encodeURI(path);
  const baseUrl = import.meta.env.BASE_URL ?? "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  if (encodedPath.startsWith("/")) {
    return `${normalizedBase}${encodedPath}`;
  }

  return `${baseUrl}${encodedPath}`;
}

export function getRelatives(personId: string): {
  parents: Person[];
  children: Person[];
  spouses: Person[];
  siblings: Person[];
} {
  const person = getPersonById(personId);

  if (!person) {
    return { parents: [], children: [], spouses: [], siblings: [] };
  }

  const mapIdsToPeople = (ids: string[]) =>
    ids
      .map((id) => getPersonById(id))
      .filter((relative): relative is Person => relative !== undefined);

  const siblingIds = new Set<string>();
  person.parents.forEach((parentId) => {
    const parent = getPersonById(parentId);
    if (!parent) {
      return;
    }

    parent.children.forEach((childId) => {
      if (childId !== person.id) {
        siblingIds.add(childId);
      }
    });
  });

  return {
    parents: mapIdsToPeople(person.parents),
    children: mapIdsToPeople(person.children),
    spouses: mapIdsToPeople(person.spouses),
    siblings: mapIdsToPeople(Array.from(siblingIds))
  };
}
