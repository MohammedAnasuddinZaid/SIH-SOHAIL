import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "home"
  | "dumbbell"
  | "zap"
  | "trophy"
  | "chat"
  | "users"
  | "settings"
  | "play"
  | "pause"
  | "stop"
  | "camera"
  | "check"
  | "flame"
  | "heart"
  | "send"
  | "arrow-right"
  | "refresh"
  | "clock"
  | "mail"
  | "lock"
  | "shield"
  | "chart"
  | "log-out"
  | "x"
  | "copy"
  | "eye"
  | "eye-off"
  | "download"
  | "sun"
  | "moon"
  | "external"
  | "file-text"
  | "scale";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10.5V21h14V10.5" />
      <path d="M9 21v-7h6v7" />
    </>
  ),
  dumbbell: (
    <>
      <path d="M6.5 6.5v11" />
      <path d="M17.5 6.5v11" />
      <path d="M3.5 9.5v5" />
      <path d="M20.5 9.5v5" />
      <path d="M6.5 12h11" />
    </>
  ),
  zap: <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" />,
  trophy: (
    <>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v6a5 5 0 0 1-10 0z" />
      <path d="M7 6H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4" />
      <path d="M17 6h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" />
    </>
  ),
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M15 4.8a3.5 3.5 0 0 1 0 6.4" />
      <path d="M18 14.7a6.5 6.5 0 0 1 3.5 5.3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="m4.9 6.6 2.1 2.1" />
      <path d="m17 15 2.1 2.1" />
      <path d="m4.9 17.4 2.1-2.1" />
      <path d="m17 9 2.1-2.1" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5z" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1.5" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.5" />
    </>
  ),
  stop: <rect x="5.5" y="5.5" width="13" height="13" rx="2" />,
  camera: (
    <>
      <path d="M3.5 8a1.5 1.5 0 0 1 1.5-1.5h2.2l1.6-2h6.4l1.6 2h1.2A1.5 1.5 0 0 1 19.5 8v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  heart: <path d="M19 14c1.5-1.5 2-3.4 2-5a5 5 0 0 0-9-2.9A5 5 0 0 0 3 9c0 1.6.5 3.5 2 5l7 7z" />,
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 3v5h-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  shield: <path d="M12 2 4.5 5v6c0 5 3.2 8.8 7.5 11 4.3-2.2 7.5-6 7.5-11V5z" />,
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-5" />
      <path d="M12 16V7" />
      <path d="M16 16v-3" />
    </>
  ),
  "log-out": (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="m2.5 2.5 19 19" />
      <path d="M10.6 4.5A9.8 9.8 0 0 1 12 4.5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5" />
      <path d="M6.6 6.6A16.5 16.5 0 0 0 2 11.5s3.5 7 10 7a9.6 9.6 0 0 0 3.5-.7" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.9 19.1 1.4-1.4" />
      <path d="m17.7 6.3 1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  "file-text": (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M6 21h12" />
      <path d="m6 7-3 7a3 3 0 0 0 6 0z" />
      <path d="m18 7-3 7a3 3 0 0 0 6 0z" />
    </>
  ),
};

export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}