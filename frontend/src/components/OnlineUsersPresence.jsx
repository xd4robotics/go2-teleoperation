import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "../context/useAuth";
import { useOperationPresence } from "../services/useOperationPresence";

const POPOVER_WIDTH = 280;
const VIEWPORT_GAP = 12;

function roleLabel(role) {
  return role === "admin" ? "ADM" : "OPERADOR";
}

function OnlineUsersPresence({ enabled = true }) {
  const { session } = useAuth();
  const user = session?.user;
  const onlineUsers = useOperationPresence(user, enabled);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
    const left = Math.min(
      Math.max(VIEWPORT_GAP, rect.left),
      window.innerWidth - width - VIEWPORT_GAP,
    );
    setPosition({ left, top: rect.bottom + 8, width });
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    updatePosition();
    function closeOnOutsideClick(event) {
      if (
        !triggerRef.current?.contains(event.target) &&
        !popoverRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }
    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  if (!enabled || !user) return null;

  return (
    <div className="online-users-presence">
      <button
        ref={triggerRef}
        className={`online-users-trigger ${isOpen ? "is-open" : ""}`}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls="online-users-popover"
        onClick={() => setIsOpen((current) => !current)}
      >
        USUÁRIOS · <strong>{onlineUsers.length} ONLINE</strong>
      </button>

      {isOpen && position && createPortal(
        <section
          ref={popoverRef}
          id="online-users-popover"
          className="online-users-popover"
          aria-label="Usuários online"
          style={position}
        >
          <strong className="online-users-popover__title">USUÁRIOS ONLINE</strong>
          {onlineUsers.length > 0 ? (
            <ul>
              {onlineUsers.map((onlineUser) => (
                <li key={onlineUser.user_id}>
                  <i aria-hidden="true" />
                  <span>{onlineUser.username}</span>
                  <b>{roleLabel(onlineUser.role)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <small>Nenhum usuário online.</small>
          )}
        </section>,
        document.body,
      )}
    </div>
  );
}

export default OnlineUsersPresence;
