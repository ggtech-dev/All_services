import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Navbar from './components/Navbar.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Home from './pages/Home.jsx';
import Category from './pages/Category.jsx';
import AdminLayout from './admin/AdminLayout.jsx';
import Dashboard from './admin/Dashboard.jsx';
import Services from './admin/Services.jsx';
import Products from './admin/Products.jsx';
import ServiceShop from './pages/ServiceShop.jsx';
import Categories from './admin/Categories.jsx';
import Pricing from './admin/Pricing.jsx';
import Settings from './admin/Settings.jsx';
import Activity from './admin/Activity.jsx';

const Loading = () => <div className="center-screen"><div className="spinner" /></div>;

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <>
      <Navbar />
      <main className="container">{children}</main>
    </>
  );
}

function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login?as=admin" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/category/:slug" element={<Protected><Category /></Protected>} />
      <Route path="/service/:slug" element={<Protected><ServiceShop /></Protected>} />
      <Route path="/admin" element={<AdminOnly><AdminLayout /></AdminOnly>}>
        <Route index element={<Dashboard />} />
        <Route path="services" element={<Services />} />
        <Route path="products" element={<Products />} />
        <Route path="categories" element={<Categories />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="settings" element={<Settings />} />
        <Route path="activity" element={<Activity />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
