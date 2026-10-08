#!/usr/bin/env python3
"""TRUSTREAM — reference tile-pipeline implementation (first runnable build).

Law: live bytes are packed in 4 KiB tiles, stream order
    ZERO -> MATH -> PHRASE -> STORE
Quiet tiles shrink; busy tiles are stored so the stream never inflates
(content never expands; per-tile framing overhead is 3 bytes).

Tile ops (frame = [tag:1][tile_len:u16 LE][payload]):
    0x00 ZERO   tile is all zeros            -> payload empty (3 bytes/frame)
    0x01 MATH   tile is an exact u8 ramp     -> payload = start u8 + step i8
                                               (5 bytes/frame)
    0x02 PHRASE reserved                     -> encoder never emits;
                                               decoder reports not-implemented
    0x03 STORE  anything else                -> payload = raw tile bytes

Reference: the law as stated in site copy (trustream.html) and the CuNi toy
spec (cuni-langs/examples/compressors/trustream.cuni: "Run a 16-byte tile
(law size stays 4096)").
"""

from __future__ import annotations

import struct

TILE = 4096

TAG_ZERO = 0x00
TAG_MATH = 0x01
TAG_PHRASE = 0x02
TAG_STORE = 0x03

_FRAME_HDR = struct.Struct("<BH")  # tag u8, tile_len u16


def _is_ramp(tile: bytes):
    """If tile is an exact u8 arithmetic ramp, return (start, step)."""
    if len(tile) < 2:
        return None
    start = tile[0]
    step = (tile[1] - tile[0]) % 256
    if step > 127:
        step -= 256
    for i in range(2, len(tile)):
        if (start + step * i) % 256 != tile[i]:
            return None
    return start, step


def encode_tile(tile: bytes):
    """Encode one tile. Returns (tag, payload). Never expands content."""
    if not tile:
        raise ValueError("empty tile")
    if len(tile) > TILE:
        raise ValueError("tile exceeds %d bytes" % TILE)
    if tile == bytes(len(tile)):
        return TAG_ZERO, b""
    ramp = _is_ramp(tile)
    if ramp is not None:
        start, step = ramp
        return TAG_MATH, struct.pack("bB", step, start)
    return TAG_STORE, tile


def decode_tile(tag: int, tile_len: int, payload: bytes) -> bytes:
    if tag == TAG_ZERO:
        if payload:
            raise ValueError("ZERO tile with payload")
        return bytes(tile_len)
    if tag == TAG_MATH:
        if len(payload) != 2:
            raise ValueError("MATH tile needs 2-byte payload")
        step, start = struct.unpack("bB", payload)
        return bytes((start + step * i) % 256 for i in range(tile_len))
    if tag == TAG_PHRASE:
        raise NotImplementedError(
            "PHRASE op is reserved in this reference build; "
            "encoder never emits it")
    if tag == TAG_STORE:
        if len(payload) != tile_len:
            raise ValueError("STORE payload length mismatch")
        return payload
    raise ValueError("unknown tile tag 0x%02x" % tag)


def encode_stream(data: bytes) -> bytes:
    """Encode bytes into a TRUSTREAM frame stream."""
    out = bytearray()
    for off in range(0, len(data), TILE):
        tile = data[off:off + TILE]
        tag, payload = encode_tile(tile)
        out += _FRAME_HDR.pack(tag, len(tile)) + payload
    return bytes(out)


def decode_stream(stream: bytes) -> bytes:
    """Decode a TRUSTREAM frame stream. Raises on truncation/corruption."""
    out = bytearray()
    pos = 0
    while pos < len(stream):
        if pos + _FRAME_HDR.size > len(stream):
            raise ValueError("truncated frame header at %d" % pos)
        tag, tile_len = _FRAME_HDR.unpack_from(stream, pos)
        pos += _FRAME_HDR.size
        if tag == TAG_ZERO:
            payload = b""
        elif tag == TAG_MATH:
            payload = stream[pos:pos + 2]
            if len(payload) != 2:
                raise ValueError("truncated MATH payload")
            pos += 2
        elif tag == TAG_STORE:
            payload = stream[pos:pos + tile_len]
            if len(payload) != tile_len:
                raise ValueError("truncated STORE payload")
            pos += tile_len
        elif tag == TAG_PHRASE:
            raise NotImplementedError("PHRASE op reserved")
        else:
            raise ValueError("unknown tile tag 0x%02x at %d" % (tag, pos))
        out += decode_tile(tag, tile_len, payload)
    return bytes(out)


def tile_ops(stream: bytes):
    """Inspect a stream: list of (tag, tile_len, frame_bytes)."""
    ops = []
    pos = 0
    while pos < len(stream):
        tag, tile_len = _FRAME_HDR.unpack_from(stream, pos)
        if tag == TAG_ZERO:
            pay = 0
        elif tag == TAG_MATH:
            pay = 2
        elif tag == TAG_STORE:
            pay = tile_len
        else:
            raise ValueError("unknown tag 0x%02x" % tag)
        ops.append((tag, tile_len, _FRAME_HDR.size + pay))
        pos += _FRAME_HDR.size + pay
    return ops


TAG_NAME = {TAG_ZERO: "ZERO", TAG_MATH: "MATH",
            TAG_PHRASE: "PHRASE", TAG_STORE: "STORE"}
