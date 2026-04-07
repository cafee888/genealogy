import { Link } from "react-router-dom";
import type { Photo } from "../types";
import { resolveAssetUrl } from "../utils/genealogy";

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
            <img src={resolveAssetUrl(photo.url)} alt={photo.caption} loading="lazy" />
            <div>
              <p>{photo.caption}</p>
              {(() => {
                const metaParts = [photo.year, photo.location].filter(
                  (value): value is number | string => value !== null && value !== undefined && `${value}`.trim() !== ""
                );

                return metaParts.length > 0 ? <small>{metaParts.join(", ")}</small> : null;
              })()}
            </div>
          </article>
        </Link>
      ))}
    </div>
  );
}

export default PhotoGallery;
