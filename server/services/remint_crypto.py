"""Passphrase-sealed encryption for encrypted place re-mints.

When a place is re-minted with ``encrypted=True``, the ledger snapshot
(channel roster, member roster, media filenames) must be sealed so that
only a holder of the new owner's passphrase can recover it. The server
persists CIPHERTEXT ONLY in ``PlaceLedgerHeader.payload`` — the plaintext
snapshot is never written to disk for an encrypted re-mint.

## Scheme

Mirrors the established Concord porch-backup AEAD pattern
(``src-tauri/src/porch/backup.rs``): AEAD over the snapshot bytes with a
passphrase-derived key, ciphertext-only at rest.

Layout of the sealed bytes (before base64):

    [1 version byte = 0x01]
    [16 salt bytes]
    [12 nonce bytes]
    [ciphertext + 16-byte GCM tag]

- **Cipher**: AES-256-GCM (AEAD). 12-byte nonce per RFC 5116.
- **KDF**: scrypt (RFC 7914) over the UTF-8 passphrase with the per-blob
  random salt, N=2**15, r=8, p=1, 32-byte derived key. scrypt is in the
  Python stdlib (``hashlib.scrypt``, OpenSSL-backed) so no extra
  dependency is needed for key derivation.
- **AAD**: the version byte is fed as additional authenticated data so a
  downgrade that flips the version is rejected by tag verification.

The whole sealed buffer is base64'd to fit the existing ``payload``
``String`` column without a schema change. ``encrypted=False`` payloads
keep their plaintext-base64 shape; the leading version byte + GCM tag
make the two trivially distinguishable and non-interchangeable.

## Invariants

1. Ciphertext-only: ``seal_snapshot`` returns no plaintext; the caller
   must not also persist the plaintext snapshot when encrypting.
2. Passphrase-gated: ``open_snapshot`` with a wrong passphrase raises
   ``InvalidToken`` (GCM tag mismatch) — it never returns garbage.
3. Tamper-evident: any bit flip in salt/nonce/ciphertext fails the tag.
"""

from __future__ import annotations

import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Format version. Bump if the layout or KDF parameters change; an old
# reader rejects a new blob by construction because the AAD (and thus the
# GCM tag) differ.
_VERSION = 0x01

_SALT_LEN = 16
_NONCE_LEN = 12
_KEY_LEN = 32  # AES-256

# scrypt cost parameters. N must be a power of two. These give a ~tens-of-ms
# derivation on commodity hardware — enough to slow brute force, cheap
# enough for an interactive ownership transfer. maxmem must be raised above
# the default 32 MiB ceiling for N=2**15.
_SCRYPT_N = 1 << 15
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024


class RemintCryptoError(Exception):
    """Raised when an encrypted re-mint payload cannot be sealed/opened."""


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    """Derive a 32-byte AES key from a passphrase + salt via scrypt."""
    return hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_KEY_LEN,
        maxmem=_SCRYPT_MAXMEM,
    )


def seal_snapshot(plaintext: bytes, passphrase: str) -> bytes:
    """Seal ``plaintext`` under ``passphrase``. Returns the sealed buffer.

    The returned buffer is ``[version][salt][nonce][ciphertext+tag]`` and
    contains NO recoverable plaintext. Callers persist this (base64'd)
    and must not also store the plaintext snapshot.
    """
    if not passphrase:
        raise RemintCryptoError("A passphrase is required to seal an encrypted re-mint.")
    salt = os.urandom(_SALT_LEN)
    nonce = os.urandom(_NONCE_LEN)
    key = _derive_key(passphrase, salt)
    aesgcm = AESGCM(key)
    version = bytes([_VERSION])
    ciphertext = aesgcm.encrypt(nonce, plaintext, version)  # version as AAD
    return version + salt + nonce + ciphertext


def open_snapshot(sealed: bytes, passphrase: str) -> bytes:
    """Open a sealed buffer with ``passphrase``. Returns the plaintext.

    Raises ``RemintCryptoError`` on a wrong passphrase, a tampered blob,
    a truncated buffer, or an unrecognised version byte. Never returns
    garbage on failure — the GCM tag is verified before any plaintext is
    released.
    """
    if not passphrase:
        raise RemintCryptoError("A passphrase is required to open an encrypted re-mint.")
    min_len = 1 + _SALT_LEN + _NONCE_LEN + 16  # +16 for the GCM tag
    if len(sealed) < min_len:
        raise RemintCryptoError("Sealed re-mint payload is truncated.")
    version = sealed[0]
    if version != _VERSION:
        raise RemintCryptoError(f"Unsupported re-mint payload version: {version}")
    off = 1
    salt = sealed[off:off + _SALT_LEN]; off += _SALT_LEN
    nonce = sealed[off:off + _NONCE_LEN]; off += _NONCE_LEN
    ciphertext = sealed[off:]
    key = _derive_key(passphrase, salt)
    aesgcm = AESGCM(key)
    try:
        return aesgcm.decrypt(nonce, ciphertext, bytes([_VERSION]))
    except InvalidTag as exc:
        raise RemintCryptoError(
            "Decryption failed: wrong passphrase or tampered payload."
        ) from exc


def is_sealed(sealed: bytes) -> bool:
    """Best-effort check that a buffer looks like a sealed re-mint blob.

    Distinguishes an encrypted payload (leading version byte + minimum
    length) from a plaintext-base64 snapshot. Used only for diagnostics;
    authenticity is still established by the GCM tag in ``open_snapshot``.
    """
    return len(sealed) >= (1 + _SALT_LEN + _NONCE_LEN + 16) and sealed[0] == _VERSION
