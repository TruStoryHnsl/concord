import { useId } from "react";
import { ConcordLogo } from "../brand/ConcordLogo";

export type SourceBrand = "concord" | "concord-p2p" | "matrix" | "mozilla" | "reticulum";

export function inferSourceBrand(input: {
  /**
   * The platform tag from `ConcordSource.platform`. Kept in sync with
   * the source-store union. `concord-p2p` (Feature F2) is a Concord
   * instance reached over the libp2p/p2p (porch) transport rather than
   * over HTTP/web — a FUNDAMENTALLY different connection kind that the
   * user must be able to tell apart at a glance, so it gets its own
   * brand glyph (a peer/mesh mark) rather than the plain web-Concord
   * logo. (Previously it collapsed to `"concord"` and was visually
   * indistinguishable from a web source.)
   */
  platform?: "concord" | "matrix" | "reticulum" | "concord-p2p";
  host?: string;
  instanceName?: string;
  serverName?: string;
}): SourceBrand {
  if (input.platform === "concord-p2p") {
    return "concord-p2p";
  }
  if (input.platform === "reticulum") {
    return "reticulum";
  }
  if (input.platform === "matrix") {
    const fields = [input.host, input.instanceName, input.serverName]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (
      fields.includes("mozilla") ||
      fields.includes("modular.im") ||
      fields.includes("chat.mozilla.org")
    ) {
      return "mozilla";
    }
    return "matrix";
  }
  return "concord";
}

export function SourceBrandIcon({
  brand,
  size = 20,
  className,
  color,
}: {
  brand: SourceBrand;
  size?: number;
  className?: string;
  /**
   * INS-069 — optional override for the icon's drawing colour. When
   * provided, it's applied via inline style so it wins over any
   * `text-on-surface`-style classnames coming in via `className`.
   * Used by the SourcesPanel tile to colour the icon to match the
   * upstream instance's accent colour.
   *
   * Pass an exact CSS colour value (`#aabbcc`, `rgb(...)`, etc.).
   * The component does NOT validate — callers should validate first
   * (the well-known parser already does this).
   */
  color?: string;
}) {
  const mozillaGradientId = useId();
  // Inline `color` propagates to `currentColor` in the SVG paths via
  // CSS inheritance (we pass the style down on the wrapping element).
  // Using `style` rather than a classname so the override beats any
  // tailwind text-* class on the same element.
  const colorStyle = color ? { color } : undefined;

  if (brand === "concord") {
    return <ConcordLogo size={size} className={className} style={colorStyle} />;
  }

  if (brand === "concord-p2p") {
    // Peer/mesh mark: three linked nodes. Reads as "this is a
    // peer-to-peer (porch) connection", distinct from the solid
    // web-Concord logo. Deliberately different from the reticulum
    // radio-wave glyph so the three p2p-ish kinds stay distinguishable.
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        style={colorStyle}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* three peers linked in a triangle mesh */}
        <line x1="7" y1="7.5" x2="17" y2="7.5" />
        <line x1="7" y1="7.5" x2="12" y2="16.5" />
        <line x1="17" y1="7.5" x2="12" y2="16.5" />
        <circle cx="7" cy="7.5" r="2.4" fill="currentColor" stroke="none" />
        <circle cx="17" cy="7.5" r="2.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="16.5" r="2.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (brand === "matrix") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        style={colorStyle}
        aria-hidden="true"
      >
        <path
          d="M7.75 6.5H5.5v11h2.25v-1.75H7v-7.5h.75V6.5Zm8.5 0v1.75H17v7.5h-.75v1.75h2.25v-11h-2.25Zm-7.2 8.8V8.7h1.4l1.55 2.35 1.55-2.35h1.4v6.6H13.5V11.2l-1.5 2.2-1.5-2.2v4.1H9.05Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (brand === "mozilla") {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        style={colorStyle}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={mozillaGradientId} x1="4" y1="4" x2="20" y2="20">
            <stop offset="0" stopColor="#FF7A18" />
            <stop offset="1" stopColor="#FF2D55" />
          </linearGradient>
        </defs>
        <path
          d="M6.5 16.9V7.1h1.95l1.95 3.2 1.95-3.2h1.9v9.8h-1.75v-6.7l-2.1 3.35-2.1-3.35v6.7H6.5Zm9.2 0V7.1h2.05q1.65 0 2.55.75.95.8.95 2.2 0 1.5-.95 2.3-.9.8-2.55.8h-.35v3.75H15.7Zm1.75-5.25h.35q.8 0 1.2-.35.45-.35.45-1.15 0-.7-.45-1.05-.4-.35-1.2-.35h-.35v2.9Z"
          fill={`url(#${mozillaGradientId})`}
        />
      </svg>
    );
  }

  if (brand === "reticulum") {
    // Reticulum network icon: stylised radio-wave / mesh node symbol
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        style={colorStyle}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Centre node */}
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        {/* Inner arc pair */}
        <path d="M9.17 9.17a4 4 0 0 0 0 5.66" />
        <path d="M14.83 9.17a4 4 0 0 1 0 5.66" />
        {/* Outer arc pair */}
        <path d="M6.34 6.34a8 8 0 0 0 0 11.32" />
        <path d="M17.66 6.34a8 8 0 0 1 0 11.32" />
      </svg>
    );
  }

  return <ConcordLogo size={size} className={className} style={colorStyle} />;
}
