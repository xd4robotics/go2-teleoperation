import { useEffect, useState } from "react";

import styles from "./TechnicalScanner.module.css";

const streams = [
  "NODE_07 // LATENCY 12ms",
  "AES CHANNEL // ENCRYPTED",
  "EDGE RELAY // SYNCHRONIZED",
];

export default function TechnicalScanner() {
  const [packetCount, setPacketCount] = useState(24831);

  useEffect(() => {
    const timer = window.setInterval(
      () => setPacketCount((value) => value + Math.ceil(Math.random() * 7)),
      900,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={styles.scanner}>
      <div className={styles.grid} />
      <div className={styles.beam} />
      <div className={styles.redBeam} />
      <div className={styles.noise} />

      <div className={styles.topline}>
        <span>XD4 // ORACLE CLOUD INFRASTRUCTURE</span>
        <b><i /> NETWORK ONLINE</b>
      </div>

      <div className={styles.copy}>
        <span className={styles.index}>01 / CONTROL ENVIRONMENT</span>
        <h2>Mission control.<br /><em>Reimagined.</em></h2>
        <p>
          Infraestrutura inteligente para operações remotas de alta precisão,
          com monitoramento contínuo e resposta em tempo real.
        </p>
      </div>

      <div className={styles.radar} aria-hidden="true">
        <span className={styles.ringOne} />
        <span className={styles.ringTwo} />
        <span className={styles.crossX} />
        <span className={styles.crossY} />
        <span className={styles.core} />
        <span className={styles.orbit} />
      </div>

      <div className={styles.streams}>
        {streams.map((stream, index) => (
          <div key={stream}>
            <span>0{index + 1}</span>
            <p>{stream}</p>
            <i />
          </div>
        ))}
      </div>

      <div className={styles.packet}>
        <span>PACKET STREAM</span>
        <strong>{packetCount.toLocaleString("pt-BR")}</strong>
      </div>
    </div>
  );
}
