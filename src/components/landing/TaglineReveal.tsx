"use client";

import { useEffect, useRef } from "react";

/**
 * Tagline reveal: every word starts muted (30% opacity) and switches to full colour on its own
 * as it crosses a trigger line about two thirds down the viewport. One IntersectionObserver, one callback,
 * no scroll listener. Reduced motion shows the final text straight away (landing.css).
 */
export default function TaglineReveal({ lines }: { lines: string[] }) {
  const root = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      root.current?.querySelectorAll(".lp-word").forEach((w) => w.classList.add("is-on"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const above = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
          entry.target.classList.toggle("is-on", entry.isIntersecting || above);
        }
      },
      { rootMargin: "0px 0px -34% 0px", threshold: 0 },
    );
    el.querySelectorAll(".lp-word").forEach((w) => io.observe(w));
    return () => io.disconnect();
  }, []);

  return (
    <h2 ref={root} className="heading-2 lp-tagline" aria-label={lines.join(" ")}>
      {lines.map((line) => (
        <span key={line} className="lp-tagline-line" aria-hidden="true">
          {line.split(" ").map((word, i) => (
            <span key={`${word}-${i}`}>
              <span className="lp-word" style={{ ["--wi" as string]: i }}>{word}</span>{" "}
            </span>
          ))}
        </span>
      ))}
    </h2>
  );
}
