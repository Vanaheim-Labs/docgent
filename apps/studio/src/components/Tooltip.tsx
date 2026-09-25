"use client";
/**
 * Tooltip.tsx
 *
 * Portal-based tooltip. Renders into document.body so no ancestor
 * overflow:hidden can clip it.
 *
 * The wrapper is display:inline-flex so getBoundingClientRect() returns
 * a real box. display:contents looks right but gives zero dimensions —
 * the tooltip always ends up at (0,0) and is never visible.
 */
import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  text: string;
  children: React.ReactElement;
  disabled?: boolean;
};

export function Tooltip({ text, children, disabled }: Props) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (disabled) return;
    timerRef.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // guard against zero-rect
      setPos({ top: r.top, left: r.left + r.width / 2 });
      setVisible(true);
    }, 100);
  }, [disabled]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
      {visible && typeof window !== "undefined" && createPortal(
        <div style={{
          position: "fixed",
          top: pos.top - 6,
          left: pos.left,
          transform: "translate(-50%, -100%)",
          background: "#1a1f2e",
          color: "#f0f4f8",
          fontSize: 11,
          fontFamily: "var(--sans, system-ui, sans-serif)",
          fontWeight: 500,
          lineHeight: 1.3,
          whiteSpace: "nowrap",
          padding: "4px 8px",
          borderRadius: 5,
          pointerEvents: "none",
          zIndex: 9999,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        }}>
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}
