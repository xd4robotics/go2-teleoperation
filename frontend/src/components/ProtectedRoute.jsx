import { Navigate, useLocation } from "react-router";

import { useAuth } from "../context/useAuth";

function ProtectedRoute({ children }) {
  const location = useLocation();
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="auth-loading">Validando sessão...</div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

export function AdminRoute({ children }) {
  const location = useLocation();
  const { session, user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="auth-loading">Validando perfil...</div>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default ProtectedRoute;
