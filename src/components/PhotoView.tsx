import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { getAllPhotos, getPersonById, resolveAssetUrl } from "../utils/genealogy";

function formatPersonLabel(name: string, chineseName: string | null): string {
  return chineseName ? `${name} (${chineseName})` : name;
}

interface PhotoViewLocationState {
  fromPersonId?: string;
}

function PhotoView() {
  const { photoId } = useParams();
  const location = useLocation();
  const [zoom, setZoom] = useState(1);

  if (!photoId) {
    return <p className="panel">Missing photo ID.</p>;
  }

  const photo = getAllPhotos().find((item) => item.id === photoId);

  if (!photo) {
    return <p className="panel">Photo not found.</p>;
  }

  const state = location.state as PhotoViewLocationState | null;
  const fromPersonId = state?.fromPersonId;
  const backTarget = fromPersonId ? `/person/${fromPersonId}` : photo.people[0] ? `/person/${photo.people[0]}` : "/";
  const backLabel = fromPersonId || photo.people[0] ? "Back to person" : "Back to tree";

  const handleZoomIn = () => setZoom((value) => Math.min(4, Number((value + 0.25).toFixed(2))));
  const handleZoomOut = () => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))));
  const handleResetZoom = () => setZoom(1);

  return (
    <article className="panel photo-view">
      <div className="profile-row">
        <h2>Photo</h2>
        <div className="photo-view-actions">
          <button type="button" className="photo-zoom-btn" onClick={handleZoomOut} disabled={zoom <= 1}>
            Zoom out
          </button>
          <button type="button" className="photo-zoom-btn" onClick={handleZoomIn} disabled={zoom >= 4}>
            Zoom in
          </button>
          <button type="button" className="photo-zoom-btn" onClick={handleResetZoom} disabled={zoom === 1}>
            Reset
          </button>
          <span className="photo-zoom-level">{Math.round(zoom * 100)}%</span>
          <Link to={backTarget} className="text-link">
            {backLabel}
          </Link>
        </div>
      </div>

      <div className="photo-zoom-frame">
        <img
          src={resolveAssetUrl(photo.url)}
          alt={photo.caption}
          className="photo-large"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
        />
      </div>

      <p className="caption">{photo.caption}</p>
      <p>
        <strong>Year:</strong> {photo.year ?? "Unknown"}
      </p>
      <p>
        <strong>Location:</strong> {photo.location ?? "Unknown"}
      </p>

      <div>
        <strong>Tagged people:</strong>
        <div className="tagged-people">
          {photo.people.map((personId) => {
            const person = getPersonById(personId);
            if (!person) {
              return null;
            }
            return (
              <Link key={person.id} to={`/person/${person.id}`} className="pill-link">
                {formatPersonLabel(person.name, person.chineseName)}
              </Link>
            );
          })}
        </div>
      </div>
    </article>
  );
}

export default PhotoView;
