"use client";

import { useEffect, useRef, useState } from "react";

export function useExportCooldown(durationMs = 10_000) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [availableAt, setAvailableAt] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function getRemainingSeconds() {
    if (!availableAt) {
      return 0;
    }

    return Math.max(1, Math.ceil((availableAt - Date.now()) / 1000));
  }

  function startCooldown() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const nextAvailableAt = Date.now() + durationMs;
    setAvailableAt(nextAvailableAt);
    setIsCoolingDown(true);

    timeoutRef.current = setTimeout(() => {
      setIsCoolingDown(false);
      setAvailableAt(null);
      timeoutRef.current = null;
    }, durationMs);
  }

  function tryStart() {
    if (isCoolingDown) {
      return false;
    }

    startCooldown();
    return true;
  }

  return {
    isCoolingDown,
    getRemainingSeconds,
    tryStart,
  };
}
