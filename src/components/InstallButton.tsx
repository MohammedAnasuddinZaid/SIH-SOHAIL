import { useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icons";
import { useInstallPrompt } from "../core/pwa/useInstallPrompt";

export function InstallButton({ size = "md", block = false }: { size?: "sm" | "md" | "lg"; block?: boolean }) {
  const { canInstall, installed, isIOSDevice, promptInstall } = useInstallPrompt();
  const [showHint, setShowHint] = useState(false);

  if (installed) return null;
  const worthShowing = canInstall || isIOSDevice;
  if (!worthShowing) return null;

  async function onClick() {
    if (canInstall) {
      await promptInstall();
    } else if (isIOSDevice) {
      setShowHint((v) => !v);
    }
  }

  return (
    <div className="install-wrap">
      <Button block={block} variant="primary" size={size} onClick={() => void onClick()}>
        <Icon name="download" size={16} /> Install app
      </Button>
      {showHint ? (
        <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: "10px 0 0" }}>
          Tap the Share button in Safari, then choose &quot;Add to Home Screen&quot; to install RepRush on your iPhone
          or iPad.
        </p>
      ) : null}
    </div>
  );
}