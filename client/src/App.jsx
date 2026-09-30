import { lazy, Suspense } from 'react';
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
import Account from './pages/Account.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import OrderTrack from './pages/OrderTrack.jsx';
// Admin panel, agent app and the agent application page are loaded on demand.
const AgentApply = lazy(() => import('./pages/AgentApply.jsx'));
const AdminLayout = lazy(() => import('./admin/AdminLayout.jsx'));
const Dashboard = lazy(() => import('./admin/Dashboard.jsx'));
const Orders = lazy(() => import('./admin/Orders.jsx'));
const Agents = lazy(() => import('./admin/Agents.jsx'));
const Services = lazy(() => import('./admin/Services.jsx'));
const ServiceTypes = lazy(() => import('./admin/ServiceTypes.jsx'));
const LiveMap = lazy(() => import('./admin/LiveMap.jsx'));
const AdminPromotions = lazy(() => import('./admin/Promotions.jsx'));
const Reports = lazy(() => import('./admin/Reports.jsx'));
const Products = lazy(() => import('./admin/Products.jsx'));
const Categories = lazy(() => import('./admin/Categories.jsx'));
const Pricing = lazy(() => import('./admin/Pricing.jsx'));
const Settings = lazy(() => import('./admin/Settings.jsx'));
const Activity = lazy(() => import('./admin/Activity.jsx'));
const AgentLayout = lazy(() => import('./agent/AgentLayout.jsx'));
const AgentHome = lazy(() => import('./agent/AgentHome.jsx'));
const AgentOrders = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentOrders })));
const AgentWallet = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentWallet })));
const AgentProfile = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentProfile })));
const AgentPayQr = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentPayQr })));
const DeliveryCharges = lazy(() => import('./admin/DeliveryCharges.jsx'));
const Areas = lazy(() => import('./admin/Areas.jsx'));

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
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/agent/apply" element={<AgentApply />} />

      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/category/:slug" element={<Protected><Category /></Protected>} />
      <Route path="/service/:slug" element={<Protected><ServiceShop /></Protected>} />
      <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
      <Route path="/orders" element={<Protected><MyOrders /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/orders/:id" element={<Protected><OrderTrack /></Protected>} />

      <Route path="/agent" element={<RoleOnly role="agent"><AgentLayout /></RoleOnly>}>
        <Route index element={<AgentHome />} />
        <Route path="orders" element={<AgentOrders />} />
        <Route path="wallet" element={<AgentWallet />} />
        <Route path="profile" element={<AgentProfile />} />
        <Route path="pay-qr" element={<AgentPayQr />} />
      </Route>

      <Route path="/admin" element={<RoleOnly role="admin"><AdminLayout /></RoleOnly>}>
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="agents" element={<Agents />} />
        <Route path="live" element={<LiveMap />} />
        <Route path="promotions" element={<AdminPromotions />} />
        <Route path="reports" element={<Reports />} />
        <Route path="service-types" element={<ServiceTypes />} />
        <Route path="delivery-charges" element={<DeliveryCharges />} />
        <Route path="areas" element={<Areas />} />
        <Route path="services" element={<Services />} />
        <Route path="products" element={<Products />} />
        <Route path="categories" element={<Categories />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="settings" element={<Settings />} />
        <Route path="activity" element={<Activity />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
