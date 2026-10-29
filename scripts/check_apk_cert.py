"""Fail if the APK is not signed with the certificate from keystore/debug.keystore.

Android refuses to install an update signed with a different key
("package conflicts with an existing package"), so every build must use the same key.
Usage: python3 scripts/check_apk_cert.py app.apk keystore-cert.der
"""
import hashlib
import struct
import sys


def apk_cert_sha256(path):
    d = open(path, 'rb').read()
    eocd = d.rfind(b'PK\x05\x06')
    cd_off = struct.unpack('<I', d[eocd + 16:eocd + 20])[0]
    if d[cd_off - 16:cd_off] != b'APK Sig Block 42':
        raise SystemExit('APK has no v2/v3 signing block')
    size = struct.unpack('<Q', d[cd_off - 24:cd_off - 16])[0]
    blk = d[cd_off - size - 8:cd_off - 24]
    p = 8
    while p < len(blk):
        ln = struct.unpack('<Q', blk[p:p + 8])[0]
        bid = struct.unpack('<I', blk[p + 8:p + 12])[0]
        v = blk[p + 12:p + 8 + ln]
        p += 8 + ln
        if bid in (0x7109871A, 0xF05368C0):  # v2, v3
            q = 8
            sd_len = struct.unpack('<I', v[q:q + 4])[0]
            sd = v[q + 4:q + 4 + sd_len]
            r = 4 + struct.unpack('<I', sd[0:4])[0]  # skip digests
            r += 4  # certificates sequence length
            c1 = struct.unpack('<I', sd[r:r + 4])[0]
            return hashlib.sha256(sd[r + 4:r + 4 + c1]).hexdigest()
    raise SystemExit('no v2/v3 signer found')


apk, der = sys.argv[1], sys.argv[2]
got = apk_cert_sha256(apk)
want = hashlib.sha256(open(der, 'rb').read()).hexdigest()
print('APK cert     ', got)
print('Keystore cert', want)
if got != want:
    raise SystemExit('APK is signed with the wrong key')
print('OK: signed with the fixed key')
