# pcc-bin/savant_codec2
PCC (Ptaszenski Computational Codec) CLI, built 2026-10-08 from:
- ~/workspace/savants/benchmark/savant_codec2.c
- TNSSRC engine-E: ~/workspace/tnssrc-coaster-routes/_ref/tnssrc-E/src/
- CMX arm stubbed out (cmx_stub.c — the CMX arm needs AVX; not offered by the metered tool)

Build: cc -O2 -march=x86-64 (baseline x86-64 — safe on Fly shared hosts)
CLI: savant_codec2 encode_whole <in> <out> | savant_codec2 decode <in> <origsize> <out>
Smoke-tested: encode_whole + decode roundtrip byte-identical 2026-10-08.
