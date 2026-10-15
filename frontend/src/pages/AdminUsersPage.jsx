import { useState } from "react";

import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/useAuth";
import { createManagedUser } from "../services/api";

const EMPTY_FORM = {
  display_name: "",
  email: "",
  password: "",
  confirmPassword: "",
  role: "operator",
};

function AdminUsersPage() {
  const { session } = useAuth();
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (formData.password !== formData.confirmPassword) {
      setErrorMessage("As senhas informadas não são iguais.");
      return;
    }

    setIsSubmitting(true);
    try {
      const createdUser = await createManagedUser(session.access_token, {
        display_name: formData.display_name.trim() || null,
        email: formData.email.trim(),
        password: formData.password,
        role: formData.role,
      });
      setFormData(EMPTY_FORM);
      setSuccessMessage(
        `${createdUser.display_name || createdUser.email} foi adicionado como ${
          createdUser.role === "admin" ? "administrador" : "usuário comum"
        } e já pode entrar no sistema.`,
      );
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function focusNewUserForm() {
    const emailInput = document.getElementById("managed_email");
    emailInput?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => emailInput?.focus({ preventScroll: true }), 350);
  }

  return (
    <div className="app-layout">
      <AppHeader showLogout />

      <main className="user-management-page">
        <section className="user-management-heading">
          <span className="management-eyebrow">ADMINISTRAÇÃO DE ACESSOS</span>
          <h1>Usuários e permissões</h1>
          <p>
            Crie credenciais para operadores ou conceda acesso administrativo.
          </p>
          <button
            className="ui-button ui-button--primary mobile-add-user-button"
            type="button"
            onClick={focusNewUserForm}
          >
            Incluir usuário
          </button>
        </section>

        <section className="user-management-grid">
          <form id="new-user-form" className="user-form panel" onSubmit={handleSubmit}>
            <div className="user-form-heading">
              <h2>Novo usuário</h2>
              <p>Preencha os dados e defina o nível de permissão.</p>
            </div>

            <label htmlFor="display_name">
              Nome
              <input
                id="display_name"
                name="display_name"
                type="text"
                maxLength={120}
                value={formData.display_name}
                onChange={handleChange}
                autoComplete="off"
              />
            </label>

            <label htmlFor="managed_email">
              E-mail
              <input
                id="managed_email"
                name="email"
                type="email"
                maxLength={320}
                value={formData.email}
                onChange={handleChange}
                autoComplete="off"
                required
              />
            </label>

            <label htmlFor="managed_role">
              Perfil
              <select
                id="managed_role"
                name="role"
                value={formData.role}
                onChange={handleChange}
              >
                <option value="operator">Usuário comum</option>
                <option value="admin">Administrador</option>
              </select>
            </label>

            <div className="user-form-passwords">
              <label htmlFor="managed_password">
                Senha inicial
                <input
                  id="managed_password"
                  name="password"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  value={formData.password}
                  onChange={handleChange}
                  autoComplete="new-password"
                  required
                />
              </label>

              <label htmlFor="managed_confirm_password">
                Confirmar senha
                <input
                  id="managed_confirm_password"
                  name="confirmPassword"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  autoComplete="new-password"
                  required
                />
              </label>
            </div>

            {errorMessage && (
              <p className="form-message form-message--error" role="alert">
                {errorMessage}
              </p>
            )}

            {successMessage && (
              <p className="form-message form-message--success" role="status">
                {successMessage}
              </p>
            )}

            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adicionando..." : "Adicionar usuário"}
            </button>
          </form>

          <aside className="access-summary panel">
            <h2>Níveis de acesso</h2>
            <article>
              <strong>Usuário comum</strong>
              <p>Entra diretamente no painel e opera o equipamento.</p>
            </article>
            <article>
              <strong>Administrador</strong>
              <p>Opera o equipamento e pode adicionar novos usuários.</p>
            </article>
          </aside>
        </section>
      </main>
    </div>
  );
}

export default AdminUsersPage;
