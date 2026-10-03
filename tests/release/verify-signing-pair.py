#!/usr/bin/env python3
"""Prove the updater's public key verifies what the release key signs.

`tauri signer sign` succeeding only proves the private key is *a* valid key. It
does not prove it is the partner of the public key compiled into the app — and
if it is not, every update the release workflow produces is rejected by every
installed copy, silently, forever. This checks the actual cryptography.

Usage (needs the `cryptography` package):
    python3 tests/release/verify-signing-pair.py FILE FILE.sig

Reads the public key from src-tauri/tauri.conf.json, so it checks the key the
app really trusts rather than a .pub file that might have drifted.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

REPO = Path(__file__).resolve().parents[2]


def decoded_lines(b64: str) -> list[str]:
    """Tauri wraps minisign's text formats in one more layer of base64."""
    return base64.b64decode(b64).decode().splitlines()


def main() -> int:
    data_path, sig_path = Path(sys.argv[1]), Path(sys.argv[2])

    conf = json.loads((REPO / "src-tauri/tauri.conf.json").read_text())
    pub = base64.b64decode(decoded_lines(conf["plugins"]["updater"]["pubkey"])[1])
    if pub[:2] != b"Ed":
        print("not an Ed25519 minisign public key")
        return 1
    pub_keyid, pub_raw = pub[2:10], pub[10:42]

    sig_lines = decoded_lines(sig_path.read_text().strip())
    sig = base64.b64decode(sig_lines[1])
    algo, sig_keyid, sig_raw = sig[:2], sig[2:10], sig[10:74]
    trusted = sig_lines[2].removeprefix("trusted comment: ")
    global_sig = base64.b64decode(sig_lines[3])

    if sig_keyid != pub_keyid:
        print(f"KEY ID MISMATCH: signed by {sig_keyid.hex()}, the app trusts {pub_keyid.hex()}")
        return 1

    message = data_path.read_bytes()
    # "ED" is minisign's prehashed mode, which is what tauri writes: the
    # signature covers BLAKE2b-512 of the file rather than the file itself.
    if algo == b"ED":
        message = hashlib.blake2b(message, digest_size=64).digest()

    key = Ed25519PublicKey.from_public_bytes(pub_raw)
    try:
        key.verify(sig_raw, message)
        # The trusted comment is signed too, which is what stops someone moving
        # a valid signature onto a different file name or timestamp.
        key.verify(global_sig, sig_raw + trusted.encode())
    except InvalidSignature:
        print("SIGNATURE DOES NOT VERIFY against the key compiled into the app")
        return 1

    print(f"OK — key id {pub_keyid.hex()}: the release key is the partner of the app's public key")
    return 0


if __name__ == "__main__":
    sys.exit(main())
