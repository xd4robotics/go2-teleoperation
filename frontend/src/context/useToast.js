import { useContext } from "react";

import { ToastContext } from "./toast-context";

const NOOP_TOAST = {
  notify: () => {},
  notifyError: () => {},
  notifySuccess: () => {},
  dismiss: () => {},
};

export function useToast() {
  return useContext(ToastContext) || NOOP_TOAST;
}
