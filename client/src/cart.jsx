import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';

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

  const value = useMemo(() => {
    const setQty = (productId, qty) =>
      setItems((list) =>
        qty <= 0 ? list.filter((i) => i.product_id !== productId) : list.map((i) => (i.product_id === productId ? { ...i, qty: Math.min(qty, 50) } : i))
      );
    return {
      items,
      count: items.reduce((n, i) => n + i.qty, 0),
      subtotal: items.reduce((n, i) => n + Number(i.price) * i.qty, 0),
      qtyOf: (productId) => items.find((i) => i.product_id === productId)?.qty || 0,
      add: (product, service) =>
        setItems((list) =>
          list.some((i) => i.product_id === product.id)
            ? list.map((i) => (i.product_id === product.id ? { ...i, qty: Math.min(i.qty + 1, 50) } : i))
            : [...list, {
                product_id: product.id, name: product.name, brand: product.brand, unit: product.unit,
                price: Number(product.price), mrp: product.mrp ? Number(product.mrp) : null,
                icon: product.icon || service?.category_icon, image_url: product.image_url,
                service_name: service?.name, qty: 1,
              }]
        ),
      setQty,
      remove: (productId) => setQty(productId, 0),
      clear: () => setItems(() => []),
    };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
