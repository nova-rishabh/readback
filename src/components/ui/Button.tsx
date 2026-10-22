import { clsx } from "clsx";
import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "approve";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-[5px] border font-sans font-medium whitespace-nowrap select-none " +
  "transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-45";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-sheet border-ink hover:bg-[#33312c]",
  secondary: "bg-sheet text-ink border-rule-strong hover:border-ink",
  ghost: "bg-transparent text-ink border-transparent hover:bg-rule/60",
  danger: "bg-sheet text-proof border-proof/50 hover:bg-proof-tint hover:border-proof",
  approve: "bg-moss text-sheet border-moss hover:bg-[#25573a]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[13px]",
  md: "h-9 px-3.5 text-sm",
  lg: "h-12 px-5 text-base",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return clsx(base, variants[variant], sizes[size], extra);
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest} />;
});

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
