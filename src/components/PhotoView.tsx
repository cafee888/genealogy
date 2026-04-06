import { Link, useParams } from "react-router-dom";
import { getAllPhotos, getPersonById } from "../utils/genealogy";

function PhotoView() {
  const { photoId } = useParams();

  if (!photoId) {
    return <p className="panel">Missing photo ID.</p>;
  }

  const photo = getAllPhotos().find((item) => item.id === photoId);

  if (!photo) {
    return <p className="panel">Photo not found.</p>;
  }

  return (
    <article className="panel photo-view">
      <div className="profile-row">
        <h2>Photo</h2>
        <Link to="/" className="text-link">
          Back to tree
        </Link>
      </div>

      <img src={photo.url} alt={photo.caption} className="photo-large" />

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
                {person.name}
              </Link>
            );
          })}
        </div>
      </div>
    </article>
  );
}

export default PhotoView;
