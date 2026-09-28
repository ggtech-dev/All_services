import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="brand">
          <span className="brand-logo">AS</span>
          <span>All Services</span>
        </Link>
        <div className="nav-right">
          <span className="nav-user">
            Hi, <b>{user.fullName || user.username}</b>
            {user.role !== 'customer' && <span className="role-badge">{user.role}</span>}
          </span>
          <button className="btn btn-ghost" onClick={logout}>Logout</button>
        </div>
      </div>
    </header>
  );
}
