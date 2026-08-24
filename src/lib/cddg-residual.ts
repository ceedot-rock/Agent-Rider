/**
 * CDDG Residual Fabric — public MCP surface for Agent-Rider
 * Smart Frame Certified · SFv1 · Level SF-1 · L/C/D
 * Core Compute Doctrine: start at 3 · stay small · stay simple · near-100% efficiency
 * Identity: Slid Phi Labs · Core · Cr3aToR
 *
 * Public surface only: residual energy, dual exactness (ΔE+ΔC=0),
 * Doctrine-of-3 Smart Swarms, hierarchical frames, contract binding.
 * No private coefficients or production residual engines.
 */

export const N_PLANES = 360;
export const DOCTRINE_AGENTS = ["Observer", "Builder", "Reflector"] as const;
export const MU = 0.45;
export const ALPHA = 0.15;

function fnv1a32(data: string): string {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type PlaneState = {
  n: number;
  residual: number;
  theta: number;
  fingerprints: string[];
  swarmCount: number;
};

export type SwarmRecord = {
  plane: number;
  theta: number;
  agents: readonly string[];
  at: string;
  fingerprint: string;
};

export type ContractBinding = {
  contractId: string;
  frameId: string;
  planeHint: number | null;
  residualFingerprint: string | null;
  boundAt: string;
};

export type ResidualSummary = {
  activeCount: number;
  globalEnergy: number;
  mirroredCost: number;
  dualError: number;
  topPlanes: Array<{ n: number; residual: number; swarmCount: number }>;
  swarms: number;
  bindings: number;
  stamp: string;
};

class CDDGSystem {
  planes: PlaneState[];
  mirroredCost = 0;
  globalEnergy = 0;
  stepCount = 0;
  swarms: SwarmRecord[] = [];
  bindings: ContractBinding[] = [];

  constructor() {
    this.planes = Array.from({ length: N_PLANES }, (_, n) => ({
      n,
      residual: 0,
      theta: n,
      fingerprints: [] as string[],
      swarmCount: 0,
    }));
  }

  private localEnergy(i: number): number {
    const p = this.planes[i];
    const left = this.planes[(i - 1 + N_PLANES) % N_PLANES].residual;
    const right = this.planes[(i + 1) % N_PLANES].residual;
    const jumpL = 0.5 * MU * (p.residual - left) ** 2;
    const jumpR = 0.5 * MU * (p.residual - right) ** 2;
    return 0.5 * p.residual ** 2 + jumpL + jumpR;
  }

  totalEnergy(): number {
    let e = 0;
    for (let i = 0; i < N_PLANES; i++) e += this.localEnergy(i);
    return e;
  }

  injectResidual(theta: number, delta = 1.0): string {
    const n = Math.floor(((theta % N_PLANES) + N_PLANES) % N_PLANES);
    const plane = this.planes[n];
    const oldE = this.totalEnergy();

    plane.residual += delta;
    let t = ((theta % N_PLANES) + N_PLANES) % N_PLANES;
    if (t < n) t = n;
    if (t >= n + 1) t = n + 0.999999;
    plane.theta = t;

    const fp = fnv1a32(`${n}:${plane.residual}:${delta}:${this.stepCount}`);
    plane.fingerprints.push(fp);
    if (plane.fingerprints.length > 32) plane.fingerprints.shift();

    const newE = this.totalEnergy();
    const dE = newE - oldE;
    this.mirroredCost -= dE; // ΔE + ΔC = 0
    this.globalEnergy = newE;
    return fp;
  }

  injectSwarm(theta: number): SwarmRecord {
    const n = Math.floor(((theta % N_PLANES) + N_PLANES) % N_PLANES);
    const fp = this.injectResidual(theta, 0.5);
    this.planes[n].swarmCount += 1;
    const rec: SwarmRecord = {
      plane: n,
      theta: ((theta % N_PLANES) + N_PLANES) % N_PLANES,
      agents: DOCTRINE_AGENTS,
      at: new Date().toISOString(),
      fingerprint: fp,
    };
    this.swarms.unshift(rec);
    if (this.swarms.length > 100) this.swarms.length = 100;
    return rec;
  }

  step(): {
    step: number;
    activePlanes: number;
    globalEnergy: number;
    mirroredCost: number;
    dualError: number;
    swarms: number;
  } {
    this.stepCount += 1;
    const oldE = this.totalEnergy();
    let active = 0;

    for (let i = 0; i < N_PLANES; i++) {
      const p = this.planes[i];
      if (Math.abs(p.residual) < 1e-9 && p.swarmCount === 0) continue;
      active += 1;
      const left = this.planes[(i - 1 + N_PLANES) % N_PLANES].residual;
      const right = this.planes[(i + 1) % N_PLANES].residual;
      const force = -(p.residual + MU * (p.residual - left) + MU * (p.residual - right));
      p.theta += ALPHA * force;

      const lo = p.n;
      const hi = p.n + 1;
      if (p.theta < lo) {
        const target = this.planes[(i - 1 + N_PLANES) % N_PLANES];
        const transfer = p.residual * 0.5;
        p.residual -= transfer;
        target.residual += transfer;
        p.theta = lo;
      } else if (p.theta >= hi) {
        const target = this.planes[(i + 1) % N_PLANES];
        const transfer = p.residual * 0.5;
        p.residual -= transfer;
        target.residual += transfer;
        p.theta = hi - 1e-9;
      }
      p.residual *= 0.92; // mild dissipation, Lyapunov-compatible
    }

    const newE = this.totalEnergy();
    const dE = newE - oldE;
    this.mirroredCost -= dE;
    this.globalEnergy = newE;

    return {
      step: this.stepCount,
      activePlanes: active,
      globalEnergy: round6(this.globalEnergy),
      mirroredCost: round6(this.mirroredCost),
      dualError: round9(this.globalEnergy + this.mirroredCost),
      swarms: this.swarms.length,
    };
  }

  residualSummary(): ResidualSummary {
    const active = this.planes
      .filter((p) => Math.abs(p.residual) > 1e-6 || p.swarmCount > 0)
      .map((p) => ({ n: p.n, residual: round4(p.residual), swarmCount: p.swarmCount }));
    active.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
    return {
      activeCount: active.length,
      globalEnergy: round6(this.globalEnergy),
      mirroredCost: round6(this.mirroredCost),
      dualError: round9(this.globalEnergy + this.mirroredCost),
      topPlanes: active.slice(0, 5),
      swarms: this.swarms.length,
      bindings: this.bindings.length,
      stamp: "Smart Frame Certified · SFv1 · Level SF-1 · L/C/D",
    };
  }

  queryPlane(n: number) {
    const plane = this.planes[((n % N_PLANES) + N_PLANES) % N_PLANES];
    return {
      n: plane.n,
      residual: round6(plane.residual),
      theta: plane.theta,
      swarmCount: plane.swarmCount,
      fingerprints: plane.fingerprints.slice(-8),
      interval: [plane.n, plane.n + 1],
    };
  }

  bindContract(contractId: string, frameId: string, planeHint: number | null): ContractBinding {
    const existing = this.bindings.find((b) => b.contractId === contractId);
    if (existing) return existing;

    let fp: string | null = null;
    if (planeHint != null) {
      const n = ((planeHint % N_PLANES) + N_PLANES) % N_PLANES;
      fp = this.injectResidual(n + 0.5, 0.01);
    }
    const binding: ContractBinding = {
      contractId,
      frameId,
      planeHint,
      residualFingerprint: fp,
      boundAt: new Date().toISOString(),
    };
    this.bindings.push(binding);
    return binding;
  }

  listBindings() {
    return this.bindings.slice();
  }
}

function round4(x: number) {
  return Math.round(x * 1e4) / 1e4;
}
function round6(x: number) {
  return Math.round(x * 1e6) / 1e6;
}
function round9(x: number) {
  return Math.round(x * 1e9) / 1e9;
}

/** Warm-instance residual fabric (like boxingLedger). */
const rootSystem = new CDDGSystem();

export function getResidualSystem(): CDDGSystem {
  return rootSystem;
}

export function residualEnergy() {
  const s = rootSystem.residualSummary();
  return {
    globalEnergy: s.globalEnergy,
    mirroredCost: s.mirroredCost,
    dualError: s.dualError,
    activeCount: s.activeCount,
    stamp: s.stamp,
  };
}
