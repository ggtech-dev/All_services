import { useSettings } from '../settings.js';

// Help links: Call, WhatsApp and Mail (numbers/email from Admin → Site settings).
const digits = (v) => String(v || '').replace(/\D/g, '');
const intl = (v) => {
  const d = digits(v);
  return d.length === 10 ? `91${d}` : d; // wa.me needs the country code
};

const CallIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
);
const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3 .78.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.25-.12-1.46-.72-1.69-.8-.22-.08-.39-.12-.55.12-.16.25-.63.8-.78.97-.14.16-.29.18-.53.06a6.7 6.7 0 0 1-3.34-2.92c-.25-.43.25-.4.72-1.33.08-.16.04-.3-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.73 2.73 0 0 0-.85 2.03 4.74 4.74 0 0 0 1 2.52 10.8 10.8 0 0 0 4.16 3.67c1.55.67 2.16.73 2.93.61.47-.07 1.46-.6 1.66-1.17.2-.58.2-1.07.15-1.17-.06-.1-.22-.16-.47-.28z" /></svg>
);
const MailIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.5l8 5 8-5V6zm16 2.85-7.47 4.67a1 1 0 0 1-1.06 0L4 8.85V18h16z" /></svg>
);

export default function SupportLinks({ title = 'Need help? Talk to us', className = '' }) {
  const s = useSettings();
  const phone = s.support_phone, wa = s.support_whatsapp || s.support_phone, mail = s.support_email;
  if (!phone && !wa && !mail) return null;
  return (
    <div className={`support-links ${className}`}>
      <span className="support-title">{title}</span>
      <div className="support-row">
        {phone && (
          <a className="support-btn call" href={`tel:+${intl(phone)}`} aria-label={`Call ${phone}`}>
            <CallIcon /><span>Call</span>
          </a>
        )}
        {wa && (
          <a className="support-btn whatsapp" href={`https://wa.me/${intl(wa)}?text=${encodeURIComponent('Hi All Services, I need help.')}`} target="_blank" rel="noreferrer" aria-label="WhatsApp us">
            <WhatsAppIcon /><span>WhatsApp</span>
          </a>
        )}
        {mail && (
          <a className="support-btn mail" href={`mailto:${mail}?subject=${encodeURIComponent('Help with All Services')}`} aria-label={`Email ${mail}`}>
            <MailIcon /><span>Mail</span>
          </a>
        )}
      </div>
      {phone && <small className="support-detail">{phone}{mail ? ` · ${mail}` : ''}</small>}
    </div>
  );
}
