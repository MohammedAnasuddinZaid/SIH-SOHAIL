import { useToastStore } from "../stores/toastStore";

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="toast-viewport" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind === "info" ? "ok" : t.kind}`} onClick={() => dismiss(t.id)}>
          <span style={{ fontWeight: 700 }}>{t.title}</span>
          {t.body ? <span style={{ color: "var(--text-1)" }}>{t.body}</span> : null}
        </div>
      ))}
    </div>
  );
}