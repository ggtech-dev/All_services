import SupportLinks from '../components/SupportLinks.jsx';

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="brand brand-lg">
          <span className="brand-logo">AS</span>
          <span>All Services</span>
        </div>
        <h1>Every local service,<br />one app.</h1>
        <p>Water cans, plumbers, groceries, medicines, bike repair, scrap pickup and more — booked in a tap, delivered by trusted local partners.</p>
        <div className="hero-chips">
          {['🏠 Home', '🛒 Groceries', '💊 Health', '🚗 Vehicle', '♻️ Recycling', '📦 Courier'].map((c) => (
            <span key={c} className="chip">{c}</span>
          ))}
        </div>
        <SupportLinks className="on-hero" />
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
          {children}
        </div>
        <SupportLinks className="below-card" />
      </section>
    </div>
  );
}
