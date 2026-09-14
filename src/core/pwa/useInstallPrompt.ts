// useInstallPrompt: captures the browser's beforeinstallprompt so we can offer
// a real install button (Android/Chrome/Edge), plus an iOS "Add to Home
// Screen" fallback that shows instructions instead of a fake button.

import { useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua);
  if (!ios) return false;
  const n = navigator as NavigatorWithStandalone;
  if (typeof n.standalone === "boolean") return n.standalone;
  return window.matchMedia("(display-mode: standalone)").matches;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const n = navigator as NavigatorWithStandalone;
  if (typeof n.standalone === "boolean") return n.standalone;
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function promptInstall(): Promise<boolean> {
    const evt = deferred;
    if (!evt) return false;
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferred(null);
    return choice.outcome === "accepted";
  }

  return {
    canInstall: deferred !== null,
    installed,
    isIOSDevice: isIOS(),
    promptInstall,
  };
}