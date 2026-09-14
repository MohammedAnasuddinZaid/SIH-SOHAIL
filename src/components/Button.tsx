import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./ui.css";

type Variant = "primary" | "accent" | "ghost" | "danger" | "subdued";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "subdued", size = "md", block, icon, className = "", children, ...rest },
  ref,
) {
  const classes = [
    "btn",
    variant !== "subdued" ? `btn--${variant}` : "",
    size !== "md" ? `btn--${size}` : "",
    block ? "btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
});