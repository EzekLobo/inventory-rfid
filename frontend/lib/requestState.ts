import { useEffect, useState } from "react";

export function isLatestRequest(current: number, latest: { current: number }) {
  return current === latest.current;
}

export function requestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function useDelayedLoading(active: boolean, delayMs = 300) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [active, delayMs]);

  return visible;
}
