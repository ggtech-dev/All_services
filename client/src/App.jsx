import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Navbar from './components/Navbar.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Home from './pages/Home.jsx';
import Category from './pages/Category.jsx';
import ServiceShop from './pages/ServiceShop.jsx';
import Checkout from './pages/Checkout.jsx';
import MyOrders from './pages/MyOrders.jsx';
import OrderTrack from './pages/OrderTrack.jsx';
import AgentApply from './pages/AgentApply.jsx';
import AdminLayout from './admin/AdminLayout.jsx';
import Dashboard from './admin/Dashboard.jsx';
import Orders from './admin/Orders.jsx';
import Agents from './admin/Agents.jsx';
import Services from './admin/Services.jsx';
import ServiceTypes from './admin/ServiceTypes.jsx';
import Products from './admin/Products.jsx';
import Categories from './admin/Categories.jsx';
import Pricing from './admin/Pricing.jsx';
import Settings from './admin/Settings.jsx';
import Activity from './admin/Activity.jsx';
import AgentLayout from './agent/AgentLayout.jsx';
import AgentHome from './agent/AgentHome.jsx';
import { AgentOrders, AgentProfile, AgentWallet } from './agent/AgentPages.jsx';

const Loading = () => <div className="center-screen"><div className="spinner" /></div>;
const HOME = { admin: '/admin', agent: '/agent' };

// Customer pages. Agents are sent to their own app.
function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role === 'agent') return <Navigate to="/agent" replace />;
  return (
    <>
      <Navbar />
      <main className="container">{children}</main>
    </>
  );
}

function RoleOnly({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?as=${role}`} replace />;
  if (user.role !== role) return <Navigate to={HOME[user.role] || '/'} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/agent/apply" element={<AgentApply />} />

      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/category/:slug" element={<Protected><Category /></Protected>} />
      <Route path="/service/:slug" element={<Protected><ServiceShop /></Protected>} />
      <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
      <Route path="/orders" element={<Protected><MyOrders /></Protected>} />
      <Route path="/orders/:id" element={<Protected><OrderTrack /></Protected>} />

      <Route path="/agent" element={<RoleOnly role="agent"><AgentLayout /></RoleOnly>}>
        <Route index element={<AgentHome />} />
        <Route path="orders" element={<AgentOrders />} />
        <Route path="wallet" element={<AgentWallet />} />
        <Route path="profile" element={<AgentProfile />} />
      </Route>

      <Route path="/admin" element={<RoleOnly role="admin"><AdminLayout /></RoleOnly>}>
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="agents" element={<Agents />} />
        <Route path="service-types" element={<ServiceTypes />} />
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
