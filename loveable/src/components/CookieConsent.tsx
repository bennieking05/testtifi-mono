import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "cookie-consent";

type ConsentValue = "accepted" | "rejected";

/**
 * Cookie consent opt-in banner.
 *
 * Shown until the user makes an explicit choice. The choice is persisted in
 * localStorage so the banner does not reappear on subsequent visits. Because
 * this is an opt-in model, non-essential cookies/analytics must not run until
 * `getCookieConsent()` returns "accepted".
 */
export function getCookieConsent(): ConsentValue | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show the banner if no explicit choice has been recorded yet.
    if (getCookieConsent() === null) {
      setVisible(true);
    }
  }, []);

  const record = (value: ConsentValue) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // If storage is unavailable we still hide the banner for this session.
    }
    // Let the rest of the app react (e.g. enable analytics) without a reload.
    window.dispatchEvent(
      new CustomEvent("cookie-consent-change", { detail: value })
    );
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-border bg-background/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use cookies to keep you signed in and to improve Testifi AI. With
          your consent we also use optional cookies to understand how the
          product is used. Read our{" "}
          <Link
            to="/privacy"
            className="font-medium text-primary underline underline-offset-4"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => record("rejected")}
          >
            Reject non-essential
          </Button>
          <Button size="sm" onClick={() => record("accepted")}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
