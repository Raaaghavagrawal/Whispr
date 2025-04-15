import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Chat from './components/Chat';
import { auth } from './firebase';

const PrivateRoute = ({ children }) => {
  return auth.currentUser ? children : <Navigate to="/" />;
};

const App = () => {
  useEffect(() => {
    // Set dark theme by default at app initialization
    const theme = localStorage.getItem('theme') || 'dark';
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route
            path="/chat"
            element={
              <PrivateRoute>
                <Chat />
              </PrivateRoute>
            }
          />
        </Routes>
      </div>
    </Router>
  );
};

export default App; 