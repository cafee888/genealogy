import { Link, Route, Routes } from "react-router-dom";
import FamilyTree from "./components/FamilyTree";
import PersonPage from "./components/PersonPage";
import PhotoView from "./components/PhotoView";

function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Lim Family Digital Archive</h1>
          <p>Static genealogy explorer for lineage, migration, and memory.</p>
        </div>
        <nav>
          <Link to="/">Family Tree</Link>
        </nav>
      </header>

      <main className="content-wrap">
        <Routes>
          <Route path="/" element={<FamilyTree />} />
          <Route path="/person/:personId" element={<PersonPage />} />
          <Route path="/photo/:photoId" element={<PhotoView />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
