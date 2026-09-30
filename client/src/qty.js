// How items are sold and the quantities a customer can pick (the server checks the same rules: fn_qty_ok).
//   kg: 250 g steps · litre: 500 ml steps · pack / bunch / piece: 1, 2, 3…
const STEPS = {
  kg: [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10],
  litre: [0.5, 1, 1.5, 2, 3, 4, 5],
};
const EPS = 1e-9;
const fmt = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const isWeighed = (sellBy) => sellBy === 'kg' || sellBy === 'litre';

// quantity after tapping "+" (the first tap adds 1 kg / 1 L / 1 pack)
export function nextQty(qty, sellBy) {
  const steps = STEPS[sellBy];
  if (!steps) return Math.min(Number(qty) + 1, 50);
  return steps.find((s) => s > Number(qty) + EPS) ?? steps[steps.length - 1];
}

// quantity after tapping "−" (0 = remove from cart)
export function prevQty(qty, sellBy) {
  const steps = STEPS[sellBy];
  if (!steps) return Number(qty) - 1;
  const lower = steps.filter((s) => s < Number(qty) - EPS);
  return lower.length ? lower[lower.length - 1] : 0;
}

// "250 g", "1.5 kg", "500 ml", "2 L", "3 bunches", "2 pcs", "× 2"
export function qtyLabel(qty, sellBy) {
  const q = Number(qty);
  switch (sellBy) {
    case 'kg': return q < 1 ? `${Math.round(q * 1000)} g` : `${fmt(q)} kg`;
    case 'litre': return q < 1 ? `${Math.round(q * 1000)} ml` : `${fmt(q)} L`;
    case 'bunch': return `${fmt(q)} ${q === 1 ? 'bunch' : 'bunches'}`;
    case 'piece': return `${fmt(q)} ${q === 1 ? 'pc' : 'pcs'}`;
    default: return `× ${fmt(q)}`;
  }
}

// How many "things" for the cart badge: 1.5 kg of tomatoes is one item, 3 milk packets are three.
export const countOf = (qty, sellBy) => (isWeighed(sellBy) ? 1 : Number(qty));

// 6 → "6 AM", 12 → "12 PM", 18 → "6 PM"
export const hourLabel = (h) => (h % 24 === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`);
export const windowLabel = (from, to) => (from == null ? '' : `${hourLabel(from)} – ${hourLabel(to)}`);

// "Thu 1 Oct, 6 AM – 7 AM" → "Today, 6 AM – 7 AM" / "Tomorrow, …" (the server's slot text stays the value)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function slotLabel(slot, now = new Date()) {
  // same text as the server's to_char(d, 'Dy FMDD Mon') for an India date (browsers may say "Sept")
  const day = (d) => {
    const ist = new Date(d.getTime() + 330 * 60000);
    return `${DAYS[ist.getUTCDay()]} ${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}`;
  };
  const [date, time] = [slot.slice(0, slot.indexOf(',')), slot.slice(slot.indexOf(',') + 2)];
  if (date === day(now)) return `Today, ${time}`;
  if (date === day(new Date(now.getTime() + 864e5))) return `Tomorrow, ${time}`;
  return slot;
}
