import { Button } from "./Button";
import { Icon } from "./Icons";
import { useThemeStore } from "../stores/themeStore";

export function ThemeToggle({ label = false }: { label?: boolean }) {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const next = theme === "light" ? "dark" : "light";

  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
      {label ? <span>{theme === "light" ? "Dark mode" : "Light mode"}</span> : null}
    </Button>
  );
}