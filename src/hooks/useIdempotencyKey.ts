import { useCallback, useMemo, useRef } from "react";

// Generates a key once per operation attempt and reuses it across retries of
// that same attempt (network hiccup, user clicking "Salvar" again after a
// failed response). Call reset() after a successful response, or when the
// form/modal closes, so the next distinct operation gets a fresh key.
// Never call getKey() again after generating it for a retry — regenerating
// per attempt defeats idempotency (the backend would treat each retry as a
// new operation).
export function useIdempotencyKey() {
  const keyRef = useRef<string | null>(null);

  const getKey = useCallback(() => {
    if (!keyRef.current) {
      keyRef.current = crypto.randomUUID();
    }
    return keyRef.current;
  }, []);

  const reset = useCallback(() => {
    keyRef.current = null;
  }, []);

  // Memoized so the returned object is a stable dependency in callers' useCallback/useEffect deps.
  return useMemo(() => ({ getKey, reset }), [getKey, reset]);
}
