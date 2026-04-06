import peopleData from "../data/people.json";
import photosData from "../data/photos.json";
import type { Person, Photo } from "../types";

const people = peopleData as Person[];
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

export function getRelatives(personId: string): {
  parents: Person[];
  children: Person[];
  spouses: Person[];
} {
  const person = getPersonById(personId);

  if (!person) {
    return { parents: [], children: [], spouses: [] };
  }

  const mapIdsToPeople = (ids: string[]) =>
    ids
      .map((id) => getPersonById(id))
      .filter((relative): relative is Person => relative !== undefined);

  return {
    parents: mapIdsToPeople(person.parents),
    children: mapIdsToPeople(person.children),
    spouses: mapIdsToPeople(person.spouses)
  };
}
