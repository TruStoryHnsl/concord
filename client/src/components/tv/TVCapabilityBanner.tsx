/**
 * TV Capability Banner — informs TV users about unavailable features.
 *
 * tvOS WebKit lacks WebRTC, and Google TV's webview has limited
 * MediaStream support. Voice and video channels are not functional
 * on TV platforms. This banner appears when a TV user navigates to
 * a voice or video channel, explaining the limitation clearly.
 *
 * The banner is dismissible — once dismissed it stays hidden for the
 * current session. It uses the Concord error palette (soft red tones)
 * to signal a capability gap without being alarming.
 *
 * Styling is handled by the `.tv-capability-banner` class in
 * `styles/tv.css`, which is only visible when `data-tv="true"` is
 * set on <html>.
 */

import { useState } from "react";

export interface TVCapabilityBannerProps {
  /** The feature that is unavailable (e.g. "Voice", "Video", "Camera"). */
  feature: string;
  /** Optional custom message. Defaults to a standard unavailability notice. */
  message?: string;
  /** Called when the user dismisses the banner. */
  onDismiss?: () => void;
}

/**
 * Renders a dismissible banner informing the user that a specific
 * feature is unavailable on TV devices. Hidden on non-TV platforms
 * via the `tv-capability-banner` CSS class (which requires
 * `html[data-tv="true"]`).
 */
export function TVCapabilityBanner({
  feature,
  message,
  onDismiss,
}: TVCapabilityBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const defaultMessage = `${feature} is not available on TV devices. Text chat and channel browsing work normally.`;

  return (
    <div className="tv-capability-banner" role="alert" aria-live="polite">
      <span className="material-symbols-outlined tv-capability-banner-icon" aria-hidden="true">
        {feature.toLowerCase().includes("voice") ? "volume_off" : "videocam_off"}
      </span>
      <span>{message || defaultMessage}</span>
      <button
        className="tv-capability-banner-dismiss"
        onClick={() => {
          setDismissed(true);
          onDismiss?.();
        }}
        aria-label={`Dismiss ${feature} unavailable notice`}
        data-focusable="true"
        data-focus-group="tv-main"
      >
        <span className="material-symbols-outlined">close</span>
      </button>
    </div>
  );
}
