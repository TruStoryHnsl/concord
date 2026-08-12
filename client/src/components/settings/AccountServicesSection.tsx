/**
 * WS-5 — Account-services center — native settings section.
 *
 * Lets the user DESIGNATE a trusted docker instance as their account-services
 * center, UPLOAD their encrypted account bundle to it, and SIGN IN / restore
 * from it on a freshly-linked device. Backed by the `account_relay_*` Tauri
 * commands (previously unreferenced by any client — this is the missing
 * front-end for the account-relay libp2p protocol).
 *
 * The docker instance is OPTIONAL — everything else in Concord works without
 * one. The account bundle is AEAD-sealed under the superuser seed before it
 * leaves this device, so the docker relay only ever holds ciphertext.
 *
 * Web build shows a one-line desktop-only statement — the account bundle is
 * built from the local porch + libp2p runtime, which a browser build doesn't
 * host.
 */

import { useState } from "react";

import { isTauri } from "../../api/servitude";
import {
  accountRelayDesignate,
  accountRelaySignin,
  accountRelayUpload,
} from "../../api/accountRelay";
import { useToastStore } from "../../stores/toast";

const inputClass =
  "w-full px-3 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30";
const primaryBtn =
  "px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors";
const secondaryBtn =
  "px-4 py-2 border border-outline-variant rounded-md text-sm text-on-surface hover:bg-surface-container-high disabled:opacity-40 transition-colors";

export const ACCOUNT_SERVICES_ANCHOR_ID = "account-services-section";

export function AccountServicesSection() {
  if (!isTauri()) {
    return (
      <div
        id={ACCOUNT_SERVICES_ANCHOR_ID}
        className="border-t border-outline-variant/15 pt-6 space-y-3"
        data-testid="account-services-section"
      >
        <h4 className="text-sm font-medium text-on-surface">
          Account-services center
        </h4>
        <p className="text-xs text-on-surface-variant">
          Available in the desktop app only.
        </p>
      </div>
    );
  }
  return <AccountServicesNative />;
}

function AccountServicesNative() {
  const addToast = useToastStore((s) => s.addToast);

  const [relayPeerId, setRelayPeerId] = useState("");
  const [designateBusy, setDesignateBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [signinBusy, setSigninBusy] = useState(false);

  const trimmed = relayPeerId.trim();
  const anyBusy = designateBusy || uploadBusy || signinBusy;

  const handleDesignate = async () => {
    if (!trimmed) {
      addToast("Enter the docker instance's peer-id first.", "error");
      return;
    }
    setDesignateBusy(true);
    try {
      await accountRelayDesignate(trimmed);
      addToast("Designated as your account-services center.", "success");
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Could not designate account-services center.",
        "error",
      );
    } finally {
      setDesignateBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!trimmed) {
      addToast("Enter the docker instance's peer-id first.", "error");
      return;
    }
    setUploadBusy(true);
    try {
      await accountRelayUpload(trimmed);
      addToast("Account backup uploaded to your account-services center.", "success");
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Could not upload account backup.",
        "error",
      );
    } finally {
      setUploadBusy(false);
    }
  };

  const handleSignin = async () => {
    if (!trimmed) {
      addToast("Enter the docker instance's peer-id first.", "error");
      return;
    }
    setSigninBusy(true);
    try {
      await accountRelaySignin(trimmed);
      addToast("Signed in — account restored from your account-services center.", "success");
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Could not sign in from account-services center.",
        "error",
      );
    } finally {
      setSigninBusy(false);
    }
  };

  return (
    <div
      id={ACCOUNT_SERVICES_ANCHOR_ID}
      className="border-t border-outline-variant/15 pt-6 space-y-3"
      data-testid="account-services-section"
    >
      <h4 className="text-sm font-medium text-on-surface">Account-services center</h4>
      <p className="text-xs text-on-surface-variant">
        Optionally trust a Concord docker instance to hold an encrypted backup of
        your account so a new device can sign in and restore it. This is
        optional — Concord works fully without one. The backup is encrypted on
        this device before it leaves; the docker instance only ever holds
        ciphertext.
      </p>

      <label className="block text-xs text-on-surface-variant">
        Docker instance peer-id
      </label>
      <input
        type="text"
        value={relayPeerId}
        onChange={(e) => setRelayPeerId(e.target.value)}
        placeholder="12D3Koo…"
        className={inputClass}
        data-testid="account-services-peer-id"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleDesignate()}
          disabled={anyBusy || !trimmed}
          className={secondaryBtn}
          data-testid="account-services-designate"
        >
          {designateBusy ? "Designating…" : "Designate"}
        </button>
        <button
          type="button"
          onClick={() => void handleUpload()}
          disabled={anyBusy || !trimmed}
          className={primaryBtn}
          data-testid="account-services-upload"
        >
          {uploadBusy ? "Uploading…" : "Upload backup"}
        </button>
        <button
          type="button"
          onClick={() => void handleSignin()}
          disabled={anyBusy || !trimmed}
          className={secondaryBtn}
          data-testid="account-services-signin"
        >
          {signinBusy ? "Signing in…" : "Sign in on this device"}
        </button>
      </div>
    </div>
  );
}
