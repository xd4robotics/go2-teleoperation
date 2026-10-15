import { useNavigate } from "react-router";

import xd4LogoDark from "../../assets/images/xd4robotics-escuro.svg";
import xd4LogoLight from "../../assets/images/xd4robotics-branco.svg";
import styles from "./BrandHeader.module.css";

export default function BrandHeader({
  variant = "dashboard",
  isDarkMode,
  onToggleTheme,
  onExit,
  mobileStatus,
  onMenuClick,
}) {
  const navigate = useNavigate();

  return (
    <header className={`${styles.header} ${styles[variant]}`}>
      <button
        className={styles.brands}
        type="button"
        onClick={() => navigate("/login")}
        aria-label="XD4 Robotics"
      >
        <span className={styles.logoBox}>
          <img src={isDarkMode ? xd4LogoLight : xd4LogoDark} alt="XD4 Robotics" />
        </span>
      </button>
      {mobileStatus && (
        <div className={styles.mobileStatus} aria-label="Status resumido do robô">
          <span className={mobileStatus.online ? styles.mobileOnline : styles.mobileOffline}><i />{mobileStatus.online ? "ONLINE" : "OFFLINE"}</span>
          <b>BAT {mobileStatus.battery ?? "--"}%</b>
          <b>{mobileStatus.latency ?? "--"}ms</b>
        </div>
      )}
      <div className={styles.actions}>
        <span>CONTROL TERMINAL // ONLINE</span>
        <button
          className={styles.themeToggle}
          type="button"
          onClick={onToggleTheme}
          aria-label={isDarkMode ? "Ativar modo claro" : "Ativar modo escuro"}
          title={isDarkMode ? "Modo claro" : "Modo escuro"}
        >
          <span aria-hidden="true">{isDarkMode ? "☀" : "☾"}</span>
        </button>
        {onExit && (
          <button className={styles.exit} type="button" onClick={onExit} aria-label="Sair">
            →
          </button>
        )}
        {onMenuClick && <button className={styles.mobileMenu} type="button" onClick={onMenuClick} aria-label="Abrir menu operacional" aria-haspopup="dialog">•••</button>}
      </div>
    </header>
  );
}
