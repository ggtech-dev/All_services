import { useEffect, useMemo, useState } from 'react';
import { api, uploadImage } from '../api.js';
import { PriceCell, useLoad, useToast } from './ui.jsx';
import PhotoPicker from '../components/PhotoPicker.jsx';
import QrScanner, { readUpiQrFile } from '../components/QrScanner.jsx';
import { CompanyQr } from '../components/DeliveryCharge.jsx';
import { loadSettings } from '../settings.js';

// Delivery charges: the company UPI QR customers pay them to, the "first N orders free" offer,
// and the charge for each service. (Distance-based charges can come later.)
export default function DeliveryCharges() {
  return (
    <div className="stack">
      <p className="muted toolbar-note">
        Customers pay the delivery charge to the <b>company UPI QR</b> at the door; the agent taps <b>“Received on company UPI”</b>{' '}
        before finishing. A cart from several shops pays the highest charge among them (one trip).
      </p>
      <CompanyUpi />
      <FreeOrders />
      <ChargesPerService />
    </div>
  );
}

// ---------- company UPI QR ----------
function CompanyUpi() {
  const toast = useToast();
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState({ company_upi_id: '', company_upi_name: '' });
  const [file, setFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    loadSettings(true).then((s) => {
      setSaved(s);
      setForm({ company_upi_id: s.company_upi_id || '', company_upi_name: s.company_upi_name || 'All Services' });
    });
  }, [version]);

  const fill = (upi, how) => {
    if (!upi) return setMsg('⚠️ Could not read a UPI QR in this photo. Type the UPI ID below (it is printed under the QR).');
    setForm((f) => ({ ...f, company_upi_id: upi.upiId, company_upi_name: upi.name || f.company_upi_name }));
    setMsg(`✓ ${how}: ${upi.upiId}${upi.name ? ` (${upi.name})` : ''}`);
  };
  const onFile = async (f) => {
    setFile(f);
    setMsg('');
    if (f) fill(await readUpiQrFile(f).catch(() => null), 'Read from QR');
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (!file && !saved?.company_qr_url) return setError('Add a photo of the company UPI QR');
    setBusy(true);
    try {
      const qrUrl = file ? await uploadImage(file) : saved.company_qr_url;
      await api('/admin/settings', { method: 'PUT', body: { ...form, company_upi_id: form.company_upi_id.trim(), company_qr_url: qrUrl } });
      toast('Company UPI QR saved — agents and customers see it now');
      setFile(null);
      setMsg('');
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remove the company UPI QR? Agents will collect the delivery charge in cash until you add one again.')) return;
    await api('/admin/settings', { method: 'PUT', body: { company_upi_id: '', company_qr_url: '' } });
    toast('Company UPI QR removed');
    setVersion((v) => v + 1);
  };

  return (
    <section className="panel">
      <h3>🔳 Company UPI QR</h3>
      <div className="company-upi-grid">
        <div>
          <p className="muted small">What agents show at the door:</p>
          {saved && <CompanyQr key={version} />}
          {saved?.company_upi_id && <button type="button" className="link-btn danger-text" onClick={remove}>Remove QR</button>}
        </div>
        <form className="stack-sm" onSubmit={save}>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setScanning(true)}>🔳 Scan the QR with the camera</button>
          <PhotoPicker label={saved?.company_qr_url ? 'Replace QR photo' : 'Company QR photo *'} file={file} onFile={onFile} hasExisting={!!saved?.company_qr_url} cameraFirst={false} />
          {scanning && (
            <QrScanner
              onResult={({ file: f, upiId, name }) => {
                setScanning(false);
                setFile(f);
                fill({ upiId, name }, 'Scanned');
              }}
              onClose={() => setScanning(false)}
            />
          )}
          {msg && <small className={msg.startsWith('✓') ? 'success-text' : 'muted'}>{msg}</small>}
          <label>
            UPI ID *
            <input value={form.company_upi_id} onChange={(e) => setForm({ ...form, company_upi_id: e.target.value })} placeholder="e.g. allservices@ybl" required />
          </label>
          <label>
            Name customers see
            <input value={form.company_upi_name} onChange={(e) => setForm({ ...form, company_upi_name: e.target.value })} placeholder="All Services" maxLength={60} />
          </label>
          {error && <div className="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save company QR'}</button>
          <small className="muted">Tip: use a business UPI QR (PhonePe / Paytm / GPay for Business) so every payment shows in one place.</small>
        </form>
      </div>
    </section>
  );
}

// ---------- first N orders free ----------
function FreeOrders() {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    loadSettings().then((s) => {
      setValue(s.free_delivery_orders ?? '3');
      setSaved(s.free_delivery_orders ?? '3');
    });
  }, []);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/admin/settings', { method: 'PUT', body: { free_delivery_orders: String(value).trim() } });
      setSaved(value);
      loadSettings(true);
      toast('Saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <section className="panel">
      <h3>🎉 New customer offer</h3>
      <form className="inline-form" onSubmit={save}>
        <label>
          No delivery charge on each customer's first
          <span className="inline-input"><input type="number" min="0" max="50" value={value} onChange={(e) => setValue(e.target.value)} /> orders</span>
        </label>
        <button className="btn btn-primary btn-sm" disabled={String(value) === String(saved)}>Save</button>
      </form>
      <small className="muted">0 = no free orders.</small>
    </section>
  );
}

// ---------- charge for each service ----------
function ChargesPerService() {
  const toast = useToast();
  const list = useLoad(() => api('/admin/delivery-charges'));
  const [q, setQ] = useState('');
  const [bulk, setBulk] = useState({});

  const groups = useMemo(() => {
    const out = [];
    for (const s of list.data || []) {
      if (q && !`${s.name} ${s.category_name}`.toLowerCase().includes(q.toLowerCase())) continue;
      let g = out.find((x) => x.id === s.category_id);
      if (!g) out.push((g = { id: s.category_id, name: s.category_name, icon: s.category_icon, services: [] }));
      g.services.push(s);
    }
    return out;
  }, [list.data, q]);

  const saveOne = async (s, fee) => {
    await api(`/admin/services/${s.id}/delivery-fee`, { method: 'PATCH', body: { fee } });
    toast(`${s.name}: ${Number(fee) > 0 ? `₹${Number(fee)}` : 'free delivery'}`);
    list.reload();
  };
  const saveCategory = async (g) => {
    const fee = bulk[g.id];
    if (fee === undefined || fee === '') return toast('Enter an amount first', 'error');
    if (!confirm(`Set the charge for all ${g.services.length} services in ${g.name} to ₹${Number(fee)}?`)) return;
    try {
      const r = await api('/admin/delivery-charges/category', { method: 'POST', body: { category_id: g.id, fee } });
      toast(`${g.name}: ${r.updated} service${r.updated === 1 ? '' : 's'} updated`);
      setBulk({ ...bulk, [g.id]: '' });
      list.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <section className="panel table-panel">
      <div className="panel-head">
        <h3>🚚 Charge for each service</h3>
        <input className="search" type="search" placeholder="🔍 Find a service…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="muted small panel-pad">Click a charge to change it. Shops = orders with items; bookings = a visit (plumber, repair…).</p>
      {list.error && <div className="alert">{list.error}</div>}
      {groups.map((g) => (
        <div key={g.id} className="fee-group">
          <div className="fee-group-head">
            <b>{g.icon} {g.name}</b>
            <span className="fee-bulk">
              Set all to ₹
              <input type="number" min="0" max="2000" value={bulk[g.id] ?? ''} onChange={(e) => setBulk({ ...bulk, [g.id]: e.target.value })} aria-label={`Charge for all of ${g.name}`} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveCategory(g)}>Apply</button>
            </span>
          </div>
          <div className="table-scroll">
            <table className="table">
              <tbody>
                {g.services.map((s) => (
                  <tr key={s.id} className={s.is_active ? '' : 'row-muted'}>
                    <td>
                      <b>{s.name}</b>
                      <div className="muted small">{s.products > 0 ? `🛍️ Shop · ${s.products} item${s.products === 1 ? '' : 's'}` : '🗓️ Booking'}{!s.is_active && ' · hidden'}</div>
                    </td>
                    <td className="fee-cell"><PriceCell value={s.delivery_fee} onSave={(v) => saveOne(s, v)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
      {list.data && !groups.length && <p className="muted panel-pad">No service matches “{q}”.</p>}
    </section>
  );
}
