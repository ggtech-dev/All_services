import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useCart } from '../cart.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  const cart = useCart();
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
          {user.role === 'admin' && <Link to="/admin" className="btn btn-ghost">🛡️ <span className="hide-sm">Admin panel</span></Link>}
          <NavLink to="/orders" className="btn btn-ghost">📦 <span className="hide-sm">My orders</span></NavLink>
          <NavLink to="/account" className="btn btn-ghost" title="My account">👤 <span className="hide-sm">Account</span></NavLink>
          <NavLink to="/checkout" className="btn btn-ghost cart-link" aria-label={`Cart, ${cart.count} items`}>
            🛒 <span className="hide-sm">Cart</span>
            {cart.count > 0 && <span className="cart-count">{cart.count}</span>}
          </NavLink>
          <button className="btn btn-ghost" onClick={logout} title="Logout">⎋ <span className="hide-sm">Logout</span></button>
        </div>
      </div>
    </header>
  );
}
