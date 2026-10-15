import { useState } from "react";
import { Navigate, useNavigate } from "react-router";

import BrandHeader from "../components/v2/BrandHeader";
import TechnicalScanner from "../components/v2/TechnicalScanner";
import { useAuth } from "../context/useAuth";
import styles from "./LoginPage.module.css";

async function offerPasswordSave(email, password) {
  try {
    if (window.PasswordCredential) {
      await navigator.credentials.store(
        new window.PasswordCredential({ id: email, name: email, password }),
      );
    }
  } catch {
    // O salvamento é opcional e não interfere no acesso.
  }
}

export default function LoginPage({ isDarkMode, onToggleTheme }) {
  const navigate = useNavigate();
  const { signIn, isConfigured, session, isLoading } = useAuth();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (isLoading) {
    return <div className="auth-loading">Validando sessão...</div>;
  }

  if (!isLoading && session) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    if (!formData.email || !formData.password) {
      setErrorMessage("Preencha o e-mail e a senha para continuar.");
      return;
    }

    setIsSubmitting(true);
    try {
      await signIn(formData.email, formData.password);
      await offerPasswordSave(formData.email, formData.password);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <BrandHeader
        variant="login"
        isDarkMode={isDarkMode}
        onToggleTheme={onToggleTheme}
      />

      <section className={styles.split}>
        <TechnicalScanner />

        <div className={styles.formSide}>
          <div className={styles.formWrap}>
            <div className={styles.eyebrow}>
              <span />
              SECURE OPERATOR ACCESS
            </div>
            <h1>Teleoperação<br /><em>sem fronteiras.</em></h1>
            <p className={styles.lead}>
              Controle, telemetria e inteligência operacional em uma única
              interface de missão crítica.
            </p>

            <form className={styles.form} onSubmit={handleSubmit}>
              <label>
                IDENTIFICAÇÃO DO OPERADOR
                <span className={styles.inputShell}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
                  </svg>
                  <input
                    name="email"
                    type="email"
                    placeholder="operador@empresa.com"
                    autoComplete="username"
                    value={formData.email}
                    onChange={(event) =>
                      setFormData({ ...formData, email: event.target.value })
                    }
                  />
                </span>
              </label>

              <label>
                CHAVE DE ACESSO
                <span className={styles.inputShell}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="10" width="16" height="11" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
                  </svg>
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••"
                    autoComplete="current-password"
                    value={formData.password}
                    onChange={(event) =>
                      setFormData({ ...formData, password: event.target.value })
                    }
                  />
                  <button
                    className={styles.reveal}
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "OCULTAR" : "EXIBIR"}
                  </button>
                </span>
              </label>

              {errorMessage && <p className={styles.error}>{errorMessage}</p>}
              {!isConfigured && (
                <p className={styles.notice}>
                  Ambiente sem autenticação configurada.
                </p>
              )}

              <button
                className={styles.submit}
                type="submit"
                disabled={isSubmitting || !isConfigured}
              >
                <span>{isSubmitting ? "AUTENTICANDO..." : "INICIAR SESSÃO"}</span>
                <i aria-hidden="true">→</i>
              </button>
            </form>

          </div>
        </div>
      </section>
    </main>
  );
}
