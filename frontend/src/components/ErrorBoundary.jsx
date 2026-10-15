import { Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Erro fatal na interface.", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="fatal-error-screen" role="alert">
        <h1>Algo deu errado na interface</h1>
        <p>
          O painel encontrou um erro inesperado. Nenhum comando continua sendo
          enviado ao robô. Recarregue a página para retomar a operação.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Recarregar painel
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
