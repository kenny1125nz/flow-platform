import { NavLink, Route, Routes } from 'react-router-dom';
import { useLiveEvents } from './stream';
import { BoardPage } from './pages/BoardPage';
import { PlanRunPage } from './pages/PlanRunPage';
import { DefinitionsPage } from './pages/DefinitionsPage';

export default function App() {
  useLiveEvents();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>Streams</span>
        </div>
        <nav>
          <NavLink to="/" end>
            Runlets
          </NavLink>
          <NavLink to="/definitions">Blueprints</NavLink>
        </nav>
        <div className="sidebar-note">Live updates via SSE</div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/runs/:runId" element={<BoardPage />} />
          <Route path="/plans/:runId" element={<PlanRunPage />} />
          <Route path="/definitions" element={<DefinitionsPage />} />
          <Route path="*" element={<div className="page"><h1>Not found</h1></div>} />
        </Routes>
      </main>
    </div>
  );
}
