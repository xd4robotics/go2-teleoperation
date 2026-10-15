import { Navigate, Route, Routes } from "react-router";

import ProtectedRoute from "../components/ProtectedRoute";
import DashboardPage from "../pages/DashboardPage";
import LoginPage from "../pages/LoginPage";

export default function AppRoutes({ isDarkMode, onToggleTheme }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/login"
        element={
          <LoginPage
            isDarkMode={isDarkMode}
            onToggleTheme={onToggleTheme}
          />
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage
              isDarkMode={isDarkMode}
              onToggleTheme={onToggleTheme}
            />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
