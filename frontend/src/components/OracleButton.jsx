function OracleButton({ onClick, isLoading = false, disabled = false }) {
  return (
    <button
      className="ui-button ui-button--primary oracle-button"
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
    >
      {isLoading ? "PROCESSANDO" : "CAPTURAR IMAGEM"}
    </button>
  );
}

export default OracleButton;
