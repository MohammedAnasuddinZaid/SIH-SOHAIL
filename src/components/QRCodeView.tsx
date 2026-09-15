// QRCodeView — renders a scannable QR code as SVG for any payload string.
// Uses the tiny zero-dependency `qrcode-generator` (bundled locally, no network).

import { useMemo } from "react";
import qrcode from "qrcode-generator";

export function QRCodeView({
  value,
  size = 200,
  margin = 2,
  className,
  alt = "QR code",
}: {
  value: string;
  size?: number;
  margin?: number;
  className?: string;
  alt?: string;
}) {
  const svg = useMemo(() => {
    try {
      // Type 0 = auto-pick the smallest QR version that fits the data.
      const qr = qrcode(0, "M");
      qr.addData(value);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin, scalable: true });
    } catch {
      return null;
    }
  }, [value, margin]);

  if (!svg) return null;
  return (
    <div
      className={className}
      role="img"
      aria-label={alt}
      style={{ width: size, height: size, lineHeight: 0, background: "#fff", borderRadius: 12, padding: 6 }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}