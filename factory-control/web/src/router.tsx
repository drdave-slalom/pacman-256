import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

/**
 * Minimal path-based router for the three mirror pages. No dependency, no
 * hash routing; server-side the control server falls back to the SPA shell.
 */

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

export function navigate(to: string): void {
  if (window.location.pathname !== to) {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

type LinkProps = { to: string; children: ReactNode; className?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">;

export function Link({ to, children, className, ...rest }: LinkProps) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
