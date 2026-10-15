import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ToastContext } from "./toast-context";

const MAX_VISIBLE_TOASTS = 4;
const DEFAULT_DURATION_MS = { error: 7_000, warning: 6_000, success: 4_000, info: 4_500 };
const TOAST_ICONS = { error: "⚠", warning: "⚠", success: "✓", info: "ℹ" };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toastsRef = useRef([]);
  const timersRef = useRef(new Map());
  const nextIdRef = useRef(0);

  const sync = useCallback(() => {
    setToasts([...toastsRef.current]);
  }, []);

  const dismiss = useCallback(
    (id) => {
      const timerId = timersRef.current.get(id);
      if (timerId) window.clearTimeout(timerId);
      timersRef.current.delete(id);
      const remaining = toastsRef.current.filter((toast) => toast.id !== id);
      if (remaining.length === toastsRef.current.length) return;
      toastsRef.current = remaining;
      sync();
    },
    [sync],
  );

  const notify = useCallback(
    (message, { type = "info", duration } = {}) => {
      const text = typeof message === "string" ? message.trim() : "";
      if (!text) return;
      const ttl = duration ?? DEFAULT_DURATION_MS[type] ?? DEFAULT_DURATION_MS.info;

      // Mensagem repetida apenas renova o tempo do toast já visível.
      const existing = toastsRef.current.find(
        (toast) => toast.message === text && toast.type === type,
      );
      if (existing) {
        const timerId = timersRef.current.get(existing.id);
        if (timerId) window.clearTimeout(timerId);
        timersRef.current.set(
          existing.id,
          window.setTimeout(() => dismiss(existing.id), ttl),
        );
        return;
      }

      nextIdRef.current += 1;
      const id = nextIdRef.current;
      toastsRef.current = [...toastsRef.current, { id, type, message: text }];
      while (toastsRef.current.length > MAX_VISIBLE_TOASTS) {
        const oldest = toastsRef.current[0];
        const timerId = timersRef.current.get(oldest.id);
        if (timerId) window.clearTimeout(timerId);
        timersRef.current.delete(oldest.id);
        toastsRef.current = toastsRef.current.slice(1);
      }
      timersRef.current.set(id, window.setTimeout(() => dismiss(id), ttl));
      sync();
    },
    [dismiss, sync],
  );

  const notifyError = useCallback(
    (message, options) => notify(message, { ...options, type: "error" }),
    [notify],
  );
  const notifySuccess = useCallback(
    (message, options) => notify(message, { ...options, type: "success" }),
    [notify],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ notify, notifyError, notifySuccess, dismiss }),
    [dismiss, notify, notifyError, notifySuccess],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast--${toast.type}`}
            role={toast.type === "error" ? "alert" : "status"}
          >
            <span className="toast__icon" aria-hidden="true">
              {TOAST_ICONS[toast.type] || TOAST_ICONS.info}
            </span>
            <p className="toast__message">{toast.message}</p>
            <button
              className="toast__close"
              type="button"
              aria-label="Fechar aviso"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
