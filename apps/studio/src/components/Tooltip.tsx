"use client";
/**
 * Tooltip.tsx
 *
 * A portal-based tooltip that renders into document.body so it is never
 * clipped by overflow:hidden on any ancestor (editor, pane-source, etc.).
 *
 * Usage:
 *   <Tooltip text="Bold — ⌘B">
 *     <button ...><Bold /></button>
 *   </Tooltip>
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
      setPos({
        top: r.top - 8,          // 8px above the element
        left: r.left + r.width / 2,
      });
      setVisible(true);
    }, 120); // slight delay feels natural, not instant flash
  }, [disabled]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ display: "contents" }}
    >
      {children}
      {visible && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: pos.top,
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
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            marginTop: -4,
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}
