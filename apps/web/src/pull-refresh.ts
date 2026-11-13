import { useEffect, useRef, useState } from "react";
/** Downward touch gesture at the top; never submits orders or alters the basket. */
export function usePullRefresh(
  refresh: () => Promise<void>,
  disabled: boolean,
) {
  const current = useRef({ refresh, disabled });
  current.current = { refresh, disabled };
  const [distance, setDistance] = useState(0),
    [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let start: { x: number; y: number } | null = null,
      pull = 0,
      running = false;
    const reset = () => {
      start = null;
      pull = 0;
      setDistance(0);
    };
    const begin = (event: TouchEvent) => {
      if (
        running ||
        current.current.disabled ||
        window.scrollY > 0 ||
        event.touches.length !== 1
      )
        return;
      if (
        (event.target as Element)?.closest?.(
          'input,textarea,select,[role="dialog"],[role="listbox"]',
        )
      )
        return;
      const touch = event.touches[0]!;
      start = { x: touch.clientX, y: touch.clientY };
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      if (
        current.current.disabled ||
        event.touches.length !== 1 ||
        window.scrollY > 0
      ) {
        reset();
        return;
      }
      const touch = event.touches[0]!,
        dy = touch.clientY - start.y;
      if (dy < 0 || Math.abs(touch.clientX - start.x) > 40) {
        reset();
        return;
      }
      pull = Math.min(110, dy);
      setDistance(pull);
      if (dy > 10 && event.cancelable) event.preventDefault();
    };
    const end = () => {
      const shouldRefresh =
        start && pull >= 80 && !running && !current.current.disabled;
      reset();
      if (!shouldRefresh) return;
      running = true;
      setRefreshing(true);
      void Promise.resolve()
        .then(() => current.current.refresh())
        .catch(() => {})
        .finally(() => {
          running = false;
          setRefreshing(false);
        });
    };
    window.addEventListener("touchstart", begin, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", begin);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", reset);
    };
  }, []);
  return { distance, refreshing };
}
