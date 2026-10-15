import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import xd4Logo from "../../logos/xd4robotics-escuro.svg";
import { useAuth } from "../context/useAuth";
import { useTheme } from "../context/useTheme";

function AppHeader({ showLogout = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 20);
    }

    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    function closeMenu(event) {
      if (!menuRef.current?.contains(event.target)) setIsMenuOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setIsMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function handleLogoClick() {
    navigate(showLogout ? "/dashboard" : "/login");
  }

  async function handleLogout() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setIsMenuOpen(false);
    try {
      await signOut();
    } catch (error) {
      console.warn("Não foi possível encerrar a sessão normalmente.", error);
    } finally {
      navigate("/login", { replace: true });
      setIsSigningOut(false);
    }
  }

  function navigateFromMenu(path) {
    setIsMenuOpen(false);
    navigate(path);
  }

  const isUserManagement = location.pathname.startsWith("/admin/usuarios");
  const isLogin = location.pathname === "/login";
  const headerClassName = [
    "app-header",
    isScrolled ? "app-header--scrolled" : "",
    isLogin ? "app-header--login" : "app-header--authenticated",
  ].filter(Boolean).join(" ");

  return (
    <header className={headerClassName}>
      <div className="app-header-inner">
        {!isLogin && <div className="header-menu" ref={menuRef}>
          <button
            className={`header-menu-trigger ${isMenuOpen ? "is-open" : ""}`}
            type="button"
            aria-label="Abrir menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            <span /><span /><span />
          </button>
          {isMenuOpen && (
            <nav className="header-menu-popover" aria-label="Menu principal">
              <span className="header-menu-kicker">NAVEGAÇÃO</span>
              {showLogout ? (
                <>
                  {user?.role === "admin" && (
                    <button type="button" onClick={() => navigateFromMenu(isUserManagement ? "/dashboard" : "/admin/usuarios")}>
                      {isUserManagement ? "Voltar à operação" : "Usuários e acessos"}
                    </button>
                  )}
                  <span className="header-menu-rule" />
                  <button className="header-menu-exit" type="button" onClick={handleLogout} disabled={isSigningOut}>
                    {isSigningOut ? "Saindo..." : "Encerrar sessão"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => navigate("/login")}>Acesso do operador</button>
                  <span className="header-menu-note">XD4 Robotics × Oracle</span>
                </>
              )}
            </nav>
          )}
        </div>}

        <div className="app-header-partners" aria-label="XD4 Robotics">
          <button
            className="app-header-brand"
            type="button"
            onClick={handleLogoClick}
            aria-label="Ir para a página inicial"
          >
            <span className="partner-logo-slot">
              <img
                className="app-header-logo"
                src={xd4Logo}
                alt="XD4 Robotics"
              />
            </span>
          </button>
        </div>

        {!isLogin && <div className="app-header-actions">
          {showLogout && (
            <button
              type="button"
              className="header-logout-button"
              onClick={handleLogout}
              disabled={isSigningOut}
            >
              {isSigningOut ? "Saindo..." : "Sair"}
            </button>
          )}
          <button
            type="button"
            className="theme-toggle"
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
          </button>
        </div>}
      </div>
    </header>
  );
}

export default AppHeader;
