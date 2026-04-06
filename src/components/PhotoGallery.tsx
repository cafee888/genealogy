import { Link } from "react-router-dom";
import type { Photo } from "../types";

interface PhotoGalleryProps {
  photos: Photo[];
  personId: string;
}

function PhotoGallery({ photos, personId }: PhotoGalleryProps) {
  if (photos.length === 0) {
    return <p>No photos tagged for this person yet.</p>;
  }

  return (
    <div className="gallery-grid">
      {photos.map((photo) => (
        <Link
          key={photo.id}
          to={`/photo/${photo.id}`}
          state={{ fromPersonId: personId }}
          className="photo-card-link"
        >
          <article className="photo-card">
            <img src={photo.url} alt={photo.caption} loading="lazy" />
            <div>
              <p>{photo.caption}</p>
              <small>
                {photo.year ?? "Unknown"}
                {photo.location ? `, ${photo.location}` : ""}
              </small>
            </div>
          </article>
        </Link>
      ))}
    </div>
  );
}

export default PhotoGallery;
