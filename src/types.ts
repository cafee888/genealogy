export type LocationEventType = "birth" | "migration" | "residence";

export interface LocationEvent {
  type: LocationEventType;
  place: string;
  year: number | null;
}

export interface Person {
  id: string;
  name: string;
  chineseName: string | null;
  birth: {
    date?: string | null;
    year: number | null;
    place: string | null;
  };
  death: {
    date?: string | null;
    year: number | null;
    place: string | null;
  };
  parents: string[];
  spouses: string[];
  children: string[];
  locations: LocationEvent[];
  burial: {
    place: string | null;
    notes: string | null;
  };
  bio: string;
}

export interface Photo {
  id: string;
  url: string;
  caption: string;
  year: number | null;
  location: string | null;
  people: string[];
}
