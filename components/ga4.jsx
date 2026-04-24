"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { analyticsConsentGranted } from "../lib/privacy-consent.js";

function pageView({ measurementId, pagePath }) {
  if (!measurementId) return;
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;

  window.gtag("event", "page_view", {
    page_location: window.location.href,
    page_path: pagePath,
    page_title: document.title,
    send_to: measurementId,
  });
}

/**
 * Tracks GA4 page_view on initial render and whenever Next.js navigation changes.
 */
export function GA4PageView({ measurementId, consent }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPathRef = useRef(null);

  useEffect(() => {
    if (!measurementId) return;
    if (!analyticsConsentGranted(consent)) return;

    const search = searchParams?.toString();
    const pagePath = search ? `${pathname}?${search}` : pathname;

    // Avoid double-firing when React Strict Mode re-runs effects in dev.
    if (lastPathRef.current === pagePath) return;
    lastPathRef.current = pagePath;

    pageView({ measurementId, pagePath });
  }, [consent, measurementId, pathname, searchParams]);

  return null;
}
