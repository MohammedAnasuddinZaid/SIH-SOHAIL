import type { HTMLAttributes, ReactNode } from "react";
import "./ui.css";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  pad?: "sm" | "md" | "lg";
}

export function Card({ children, pad = "md", className = "", ...rest }: CardProps) {
  const padClass = pad === "sm" ? "card--pad-sm" : pad === "lg" ? "card--pad-lg" : "";
  return (
    <div className={`card ${padClass} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

interface SectionTitleProps {
  title: ReactNode;
  aside?: ReactNode;
  hint?: ReactNode;
}

export function SectionTitle({ title, aside, hint }: SectionTitleProps) {
  return (
    <div className="section-title">
      <div>
        <h3>{title}</h3>
        {hint ? <p className="section-title__hint">{hint}</p> : null}
      </div>
      {aside ? <div className="section-title__aside">{aside}</div> : null}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "brand" | "ok" | "danger" | "info" | "accent";
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function ProgressBar({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={`progress ${className}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AvatarIcon({ name, size }: { name: string; size?: "sm" | "lg" }) {
  return <span className={`avatar-icon ${size === "lg" ? "avatar-icon--lg" : size === "sm" ? "avatar-icon--sm" : ""}`}>{initials(name)}</span>;
}

export function Skeleton({ width = "100%", height = 16, className = "" }: { width?: string | number; height?: number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ width, height }} />;
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon ? (
        <span className="empty__icon">{icon}</span>
      ) : (
        <span className="empty__icon empty__icon--plain" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v3" />
            <path d="m5.6 5.6 2.1 2.1" />
            <path d="M3 12h3" />
            <path d="m18.4 5.6-2.1 2.1" />
            <path d="M18 12h3" />
            <path d="M12 21v-3" />
            <path d="m5.6 18.4 2.1-2.1" />
            <path d="m18.4 18.4-2.1-2.1" />
          </svg>
        </span>
      )}
      <span className="empty__title">{title}</span>
      {children ? <div>{children}</div> : null}
    </div>
  );
}