import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { CartProvider } from './cart.jsx';
import { OfflineBar } from './components/InstallApp.jsx';
import './pwa.js'; // installable app: service worker + install prompt
import './styles.css';
import './admin/admin.css';
import './agent/agent.css'; // shared bits (.kv, .agent-avatar.small, .btn-agent, apply page) are used outside the agent app too

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <OfflineBar />
          <App />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
