import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

function getBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edg")) return "Edge";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  return "Other";
}

function getDeviceType(): string {
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

function getSessionId(): string {
  let sid = sessionStorage.getItem("tt_sid");
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem("tt_sid", sid);
  }
  return sid;
}

export function useAnalytics() {
  const location = useLocation();
  const startRef = useRef(Date.now());

  useEffect(() => {
    const start = Date.now();
    startRef.current = start;

    supabase.from("site_analytics").insert({
      page_path: location.pathname,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent,
      browser: getBrowser(),
      device_type: getDeviceType(),
      session_id: getSessionId(),
    }).then(() => {});

    return () => {
      const duration = Math.round((Date.now() - start) / 1000);
      if (duration > 1) {
        supabase.from("site_analytics").insert({
          page_path: location.pathname,
          session_duration: duration,
          session_id: getSessionId(),
          browser: getBrowser(),
          device_type: getDeviceType(),
        }).then(() => {});
      }
    };
  }, [location.pathname]);
}
