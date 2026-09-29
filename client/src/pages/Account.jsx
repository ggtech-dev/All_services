import { useAuth } from '../auth.jsx';
import AccountSecurity from '../components/AccountSecurity.jsx';

// Customer "My account": profile summary, email and password.
export default function Account() {
  const { user } = useAuth();
  return (
    <div className="stack">
      <h1 className="page-title">My account</h1>
      <section className="panel profile-card">
        <div className="agent-avatar">{(user.fullName || user.username)[0].toUpperCase()}</div>
        <h2>{user.fullName || user.username}</h2>
        <p className="muted">@{user.username}{user.phone && ` · ${user.phone}`}</p>
      </section>
      <AccountSecurity />
    </div>
  );
}
