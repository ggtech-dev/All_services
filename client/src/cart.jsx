import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { countOf, nextQty, prevQty } from './qty.js';
import { dataUrlToFile, shrinkPhoto } from './photos.js';

// Shopping cart kept in this browser, per logged-in user. Prices here are only for display:
// the server recalculates everything from the database when the order is placed.
const CartContext = createContext(null);

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
};

export function CartProvider({ children }) {
  const { user } = useAuth();
  const key = user ? `as_cart_${user.id}` : null;
  // The cart remembers whose it is, so switching users never writes one user's cart into another's.
  const [cart, setCart] = useState(() => ({ key, items: key ? read(key) : [] }));
  if (cart.key !== key) setCart({ key, items: key ? read(key) : [] });
  const items = cart.key === key ? cart.items : [];
  const setItems = (update) => setCart((c) => ({ ...c, items: update(c.items) }));

  useEffect(() => {
    if (!cart.key) return;
    try {
      localStorage.setItem(cart.key, JSON.stringify(cart.items));
    } catch {
      /* storage unavailable: cart just won't survive a reload */
    }
  }, [cart]);

  // The customer's own list (kirana…): typed lines and a (made smaller) photo of a handwritten list are kept
  // like the cart, so a page reload doesn't lose them.
  const listKey = user ? `as_list_${user.id}` : null;
  const readPhoto = (k) => {
    try {
      return JSON.parse(localStorage.getItem(`${k}_photo`)) || null;
    } catch {
      return null;
    }
  };
  const [own, setOwn] = useState(() => ({ key: listKey, lines: listKey ? read(listKey) : [], photo: listKey ? readPhoto(listKey) : null }));
  if (own.key !== listKey) setOwn({ key: listKey, lines: listKey ? read(listKey) : [], photo: listKey ? readPhoto(listKey) : null });
  const lines = own.key === listKey ? own.lines : [];
  const photoData = own.key === listKey ? own.photo : null; // { dataUrl, service_id, service_name }
  const photo = useMemo(() => (photoData ? { ...photoData, file: dataUrlToFile(photoData.dataUrl) } : null), [photoData]);
  useEffect(() => {
    if (!own.key) return;
    try {
      localStorage.setItem(own.key, JSON.stringify(own.lines));
      if (own.photo) localStorage.setItem(`${own.key}_photo`, JSON.stringify(own.photo));
      else localStorage.removeItem(`${own.key}_photo`);
    } catch {
      /* storage full or unavailable: the photo just won't survive a reload */
    }
  }, [own]);

  const value = useMemo(() => {
    const setQty = (productId, qty) =>
      setItems((list) =>
        qty <= 0 ? list.filter((i) => i.product_id !== productId) : list.map((i) => (i.product_id === productId ? { ...i, qty: Math.min(qty, 50) } : i))
      );
    const update = (productId, change) => setItems((list) => list.map((i) => (i.product_id === productId ? { ...i, ...change } : i)));
    const find = (productId) => items.find((i) => i.product_id === productId);
    const setLines = (update) => setOwn((o) => ({ ...o, lines: update(o.lines) }));
    return {
      items,
      // own list: [{ key, service_id, service_name, name, qty_text }] · photo: { file, service_id, service_name } | null
      lines,
      photo,
      addLine: (service) => setLines((l) => [...l, { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, service_id: service.id, service_name: service.name, name: '', qty_text: '' }].slice(0, 40)),
      // one empty line to type into (safe to call twice)
      ensureLine: (service) => setLines((l) => (l.some((x) => x.service_id === service.id) ? l : [...l, { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, service_id: service.id, service_name: service.name, name: '', qty_text: '' }])),
      updateLine: (key, change) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...change } : x))),
      removeLine: (key) => setLines((l) => l.filter((x) => x.key !== key)),
      setPhoto: async (file, service) => {
        if (!file) return setOwn((o) => ({ ...o, photo: null }));
        const dataUrl = await shrinkPhoto(file).catch(() => null);
        if (!dataUrl) throw new Error('This photo could not be read. Please try another one.');
        setOwn((o) => ({ ...o, photo: { dataUrl, service_id: service.id, service_name: service.name } }));
      },
      // 1.5 kg of tomatoes is one item on the badge; 3 milk packets are three; each own-list line is one
      count: items.reduce((n, i) => n + countOf(i.qty, i.sell_by), 0) + lines.filter((x) => x.name.trim()).length + (photo ? 1 : 0),
      // items priced by the shop bill (vegetables, meat…) are not in the total yet
      subtotal: items.reduce((n, i) => n + (i.on_bill ? 0 : Number(i.price) * i.qty), 0),
      hasBillItems: items.some((i) => i.on_bill) || lines.some((x) => x.name.trim()) || !!photo,
      qtyOf: (productId) => find(productId)?.qty || 0,
      itemOf: find,
      // first tap: 1 kg / 1 L / 1 pack; then the next step (250 g steps for kg)
      add: (product, service) =>
        setItems((list) =>
          list.some((i) => i.product_id === product.id)
            ? list.map((i) => (i.product_id === product.id ? { ...i, qty: nextQty(i.qty, i.sell_by) } : i))
            : [...list, {
                product_id: product.id, name: product.name, brand: product.brand, unit: product.unit,
                price: Number(product.price), mrp: product.mrp ? Number(product.mrp) : null,
                icon: product.icon || service?.category_icon, image_url: product.image_url,
                service_id: service?.id, service_name: service?.name, qty: 1,
                sell_by: product.sell_by || 'pack', on_bill: !!service?.price_on_bill,
                note_options: product.note_options || null, cuts: [], extra: '',
              }]
        ),
      less: (productId) => {
        const i = find(productId);
        if (i) setQty(productId, prevQty(i.qty, i.sell_by));
      },
      more: (productId) => {
        const i = find(productId);
        if (i) setQty(productId, nextQty(i.qty, i.sell_by));
      },
      // cutting instructions: tapped choices + free text → "Curry cut, Skinless, small pieces please"
      toggleCut: (productId, cut) => {
        const i = find(productId);
        if (i) update(productId, { cuts: i.cuts?.includes(cut) ? i.cuts.filter((c) => c !== cut) : [...(i.cuts || []), cut] });
      },
      setExtra: (productId, extra) => update(productId, { extra: extra.slice(0, 120) }),
      setQty,
      remove: (productId) => setQty(productId, 0),
      clear: () => {
        setItems(() => []);
        setOwn((o) => ({ ...o, lines: [], photo: null }));
      },
    };
  }, [items, lines, photo]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);

// The note sent with an item: tapped cutting choices + the customer's own words.
export const itemNote = (i) => [...(i.cuts || []), (i.extra || '').trim()].filter(Boolean).join(', ');
