import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './styles/main.css';

import Home from './pages/Home';
import CategoryPage from './pages/CategoryPage';
import RecipePage from './pages/RecipePage';
import Room from './pages/Room';

function Navbar() {
  return (
    <nav className="nav">
      <div className="nav__inner">
        <Link to="/" className="nav__logo">
          me<span>&</span>u
        </Link>
        <div className="nav__links">
          <Link to="/">Home</Link>
          <a href="/#categories">Recipes</a>
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="footer">
      Made with <span>♥</span> &amp; me&u — Cook more, stress less.
    </footer>
  );
}

function Layout({ children, showNav = true, showFooter = true }) {
  return (
    <>
      {showNav && <Navbar />}
      {children}
      {showFooter && <Footer />}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Layout><Home /></Layout>}
        />
        <Route
          path="/category/:id"
          element={<Layout><CategoryPage /></Layout>}
        />
        <Route
          path="/recipe/:id"
          element={<Layout><RecipePage /></Layout>}
        />
        <Route
          path="/room/:id"
          element={<Room />}
        />
      </Routes>
    </BrowserRouter>
  );
}
