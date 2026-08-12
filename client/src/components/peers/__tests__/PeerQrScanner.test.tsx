import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";

/**
 * `@tauri-apps/api/core` is mocked so `addPeer` (which the scanner calls
 * on a successful decode) hits a stub `invoke` instead of a real Tauri
 * bridge. The mock must be installed BEFORE the SUT imports — same
 * hoisted-mock pattern as `peerStore.test.ts`.
 */
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

/**
 * jsQR is mocked at module scope. Tests push a return value via
 * `__mockJsQRResult` for each case — same shuttle pattern the
 * GuestPairingScanner test uses.
 */
vi.mock("jsqr", () => ({
  default: vi.fn((_data: Uint8ClampedArray, _w: number, _h: number) => {
    return __mockJsQRResult;
  }),
}));
let __mockJsQRResult: { data: string } | null = null;

import { PeerQrScanner, scanImageData } from "../PeerQrScanner";
import { encodeToQrPayload, type PeerCard } from "../../../lib/peerCard";

/** A structurally-valid peer card (64-hex public key, ≥1 multiaddr). */
const VALID_CARD: PeerCard = {
  peerId: "12D3KooWExamplePeerIdForScannerTest",
  publicKeyHex: "a".repeat(64),
  multiaddrs: ["/ip4/192.168.1.50/tcp/4001"],
};
const VALID_URL = encodeToQrPayload(VALID_CARD);

/** Backend echo for a `peer_store_add` invoke — the wire shape `fromRaw`
 *  expects, with the card's own fields. */
function rawAddResult(card: PeerCard) {
  return {
    peerId: card.peerId,
    publicKeyHex: card.publicKeyHex,
    multiaddrs: card.multiaddrs,
    source: "qr",
    firstSeen: "2026-06-18T00:00:00Z",
    lastSeen: "2026-06-18T00:00:00Z",
    accessGranted: true,
    lastAccessGrantAt: "2026-06-18T00:00:00Z",
  };
}

describe("scanImageData()", () => {
  beforeEach(() => {
    __mockJsQRResult = null;
  });

  it("returns an ok DecodeResult with the card when jsQR decodes a valid peer URL", () => {
    __mockJsQRResult = { data: VALID_URL };
    const imageData = {
      data: new Uint8ClampedArray(4 * 10 * 10),
      width: 10,
      height: 10,
    } as ImageData;

    const result = scanImageData(imageData);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      // The user-visible payload: the exact card the other device shared.
      expect(result.card.peerId).toBe(VALID_CARD.peerId);
      expect(result.card.publicKeyHex).toBe(VALID_CARD.publicKeyHex);
      expect(result.card.multiaddrs).toEqual(VALID_CARD.multiaddrs);
    }
  });

  it("returns a {ok:false} DecodeResult when jsQR decodes a non-peer QR", () => {
    // e.g. an instance-pairing QR or any random URL — NOT a peer card.
    __mockJsQRResult = { data: "concord+pair://v1/?d=somethingelse" };
    const imageData = {
      data: new Uint8ClampedArray(4 * 10 * 10),
      width: 10,
      height: 10,
    } as ImageData;

    const result = scanImageData(imageData);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
  });

  it("returns null when jsQR finds no code in the frame at all", () => {
    __mockJsQRResult = null;
    const imageData = {
      data: new Uint8ClampedArray(4 * 10 * 10),
      width: 10,
      height: 10,
    } as ImageData;
    expect(scanImageData(imageData)).toBeNull();
  });
});

describe("<PeerQrScanner />", () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "mediaDevices",
  );

  beforeEach(() => {
    invokeMock.mockReset();
    __mockJsQRResult = null;
  });

  afterEach(() => {
    cleanup();
    if (originalMediaDevices) {
      Object.defineProperty(
        Navigator.prototype,
        "mediaDevices",
        originalMediaDevices,
      );
    }
  });

  it("renders a permission-denied panel with Retry when getUserMedia throws NotAllowedError", async () => {
    const notAllowed = Object.assign(new Error("denied"), {
      name: "NotAllowedError",
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockRejectedValue(notAllowed) },
      configurable: true,
    });

    const onPaired = vi.fn();
    render(<PeerQrScanner onPaired={onPaired} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("peer-qr-scanner-permission-denied"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("peer-qr-scanner-retry")).toBeInTheDocument();
    expect(onPaired).not.toHaveBeenCalled();
  });

  it("renders a no-camera panel when mediaDevices is absent entirely", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });

    const onPaired = vi.fn();
    render(<PeerQrScanner onPaired={onPaired} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("peer-qr-scanner-no-camera"),
      ).toBeInTheDocument();
    });
    expect(onPaired).not.toHaveBeenCalled();
  });

  it("adds the peer (source 'qr') and fires onPaired when a valid peer URL is pasted", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });
    invokeMock.mockResolvedValueOnce(rawAddResult(VALID_CARD));

    const onPaired = vi.fn();
    render(<PeerQrScanner onPaired={onPaired} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("peer-qr-scanner-no-camera"),
      ).toBeInTheDocument();
    });

    const input = screen.getByTestId(
      "peer-qr-scanner-manual-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: VALID_URL } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(onPaired).toHaveBeenCalledTimes(1);
    });

    // The decode→addPeer wiring: the store-add command was invoked with
    // the scanned card's fields under the "qr" source.
    expect(invokeMock).toHaveBeenCalledWith("peer_store_add", {
      peerId: VALID_CARD.peerId,
      publicKeyHex: VALID_CARD.publicKeyHex,
      multiaddrs: VALID_CARD.multiaddrs,
      source: "qr",
    });
    // The persisted peer is what onPaired receives.
    const passed = onPaired.mock.calls[0][0];
    expect(passed.peerId).toBe(VALID_CARD.peerId);
    expect(passed.source).toBe("qr");
  });

  it("shows a decode-error panel and does NOT add a peer when an invalid URL is pasted", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });

    const onPaired = vi.fn();
    render(<PeerQrScanner onPaired={onPaired} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("peer-qr-scanner-no-camera"),
      ).toBeInTheDocument();
    });

    const input = screen.getByTestId(
      "peer-qr-scanner-manual-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "concord://peer/not-base64!!" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(
        screen.getByTestId("peer-qr-scanner-decode-error"),
      ).toBeInTheDocument();
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onPaired).not.toHaveBeenCalled();
  });

  it("surfaces an add-error and does NOT fire onPaired when the store rejects", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });
    invokeMock.mockRejectedValueOnce(new Error("stronghold locked"));

    const onPaired = vi.fn();
    render(<PeerQrScanner onPaired={onPaired} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("peer-qr-scanner-no-camera"),
      ).toBeInTheDocument();
    });

    const input = screen.getByTestId(
      "peer-qr-scanner-manual-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: VALID_URL } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("peer-qr-scanner-add-error")).toBeInTheDocument();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(onPaired).not.toHaveBeenCalled();
  });
});
