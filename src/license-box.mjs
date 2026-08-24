/**
 * LicenseBox (JS) — monthly payment-check black box
 *
 * 24h trial → then open only while payment check succeeds → shut on fail.
 * Not perpetual.
 *
 * Env:
 *   LICENSE_CHECK_URL  POST → { active: bool, period_end?: number }
 *   LICENSE_PAY_URL    Stripe portal / payment link
 *   LICENSE_HMAC_SECRET
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TRIAL_SECONDS = 24 * 60 * 60;
const PERIOD_SECONDS = 30 * 24 * 60 * 60;
const DIR = path.join(os.homedir(), ".license_box");

function fp() {
  return crypto
    .createHash("sha256")
    .update([os.hostname(), os.platform(), os.arch(), process.env.USER || ""].join("|"))
    .digest("hex")
    .slice(0, 32);
}

function secret() {
  return process.env.LICENSE_HMAC_SECRET || "dev-only-change-me-in-production";
}

function sign(payload) {
  const body = JSON.stringify(payload, Object.keys(payload).sort());
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("hex");
  return `${body}.${sig}`;
}

function verify(token) {
  try {
    const i = token.lastIndexOf(".");
    const body = token.slice(0, i);
    const sig = token.slice(i + 1);
    const expected = crypto.createHmac("sha256", secret()).update(body).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function licPath(projectId) {
  fs.mkdirSync(DIR, { recursive: true });
  return path.join(DIR, `${projectId}.lic`);
}

function load(projectId) {
  try {
    const raw = JSON.parse(fs.readFileSync(licPath(projectId), "utf8"));
    const p = verify(raw.token || "");
    if (!p || p.project_id !== projectId) return null;
    return p;
  } catch {
    return null;
  }
}

function save(projectId, payload) {
  fs.writeFileSync(licPath(projectId), JSON.stringify({ token: sign(payload) }, null, 2));
}

function payUrl() {
  return process.env.LICENSE_PAY_URL || process.env.STRIPE_PAYMENT_LINK || "https://buy.stripe.com/YOUR_LINK";
}

export function issueTrial(projectId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    project_id: projectId,
    status: "trial",
    issued_at: now,
    expires_at: now + TRIAL_SECONDS,
    period_end: null,
    fp: fp(),
    license_id: crypto.randomUUID(),
    last_check: null,
    check_ok: null,
  };
  save(projectId, payload);
  return payload;
}

export function issueSubscriptionPeriod(projectId, paymentRef = "", periodSeconds = PERIOD_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    project_id: projectId,
    status: "subscribed",
    issued_at: now,
    expires_at: null,
    period_end: now + periodSeconds,
    payment_ref: paymentRef,
    fp: fp(),
    license_id: crypto.randomUUID(),
    last_check: now,
    check_ok: true,
  };
  save(projectId, payload);
  return payload;
}

export function markPaymentFailed(projectId) {
  const prev = load(projectId) || {};
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    project_id: projectId,
    status: "shut",
    issued_at: prev.issued_at || now,
    expires_at: now,
    period_end: now,
    payment_ref: prev.payment_ref || "",
    fp: fp(),
    license_id: prev.license_id || crypto.randomUUID(),
    last_check: now,
    check_ok: false,
  };
  save(projectId, payload);
  return payload;
}

async function remoteCheck(projectId) {
  const url = (process.env.LICENSE_CHECK_URL || "").trim();
  if (!url) return { active: null, mode: "offline" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, fp: fp() }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return { active: !!data.active, period_end: data.period_end, mode: "remote", raw: data };
  } catch (e) {
    return { active: false, mode: "remote_error", error: String(e) };
  }
}

export async function runPaymentCheck(projectId) {
  const remote = await remoteCheck(projectId);
  if (remote.mode === "offline") {
    const lic = load(projectId);
    const now = Math.floor(Date.now() / 1000);
    if (lic?.status === "subscribed" && (lic.period_end || 0) > now) {
      return { ok: true, status: "subscribed", message: "Local period valid (offline)", license: lic };
    }
    return { ok: false, status: "shut", message: "Period ended — payment check required", license: lic };
  }
  if (remote.active) {
    let lic;
    if (remote.period_end) {
      const now = Math.floor(Date.now() / 1000);
      lic = issueSubscriptionPeriod(projectId, "remote_ok", Math.max(60, remote.period_end - now));
    } else {
      lic = issueSubscriptionPeriod(projectId, "remote_ok");
    }
    return { ok: true, status: "subscribed", message: `Payment check OK until ${lic.period_end}`, license: lic };
  }
  const lic = markPaymentFailed(projectId);
  return {
    ok: false,
    status: "shut",
    message: `Payment check FAILED — black box shut. Renew: ${payUrl()}`,
    license: lic,
  };
}

export async function checkLicense(projectId, force = false) {
  let lic = load(projectId);
  const now = Math.floor(Date.now() / 1000);

  if (!lic) {
    lic = issueTrial(projectId);
    const left = lic.expires_at - now;
    return { ok: true, status: "trial", message: `Trial started — ${Math.floor(left / 3600)}h left`, seconds_left: left, license: lic };
  }
  if (lic.status === "shut") {
    return {
      ok: false,
      status: "shut",
      message: `Black box SHUT. Pay: ${payUrl()}`,
      seconds_left: 0,
      license: lic,
    };
  }
  if (lic.status === "trial") {
    if (now < lic.expires_at) {
      const left = lic.expires_at - now;
      return { ok: true, status: "trial", message: `Trial active — ${Math.floor(left / 3600)}h left`, seconds_left: left, license: lic };
    }
    return runPaymentCheck(projectId);
  }
  if (lic.status === "subscribed") {
    if (force || now >= (lic.period_end || 0)) return runPaymentCheck(projectId);
    const left = lic.period_end - now;
    return {
      ok: true,
      status: "subscribed",
      message: `Open ${Math.floor(left / 86400)}d until next payment check`,
      seconds_left: left,
      license: lic,
    };
  }
  return { ok: false, status: "missing", message: "No valid license", seconds_left: 0 };
}

/** Gate product entry — throws / process.exit if shut */
export async function requireLicense(projectId, { soft = false } = {}) {
  const result = await checkLicense(projectId);
  console.log(`[LicenseBox:${projectId}] ${result.status}: ${result.message}`);
  if (!result.ok && !soft) {
    console.error("\n*** BLACK BOX SHUT — payment check required ***\n");
    process.exit(1);
  }
  return result;
}

/**
 * Express/Hono-style middleware for hosted MCP / API routes.
 * Real IP protection: refuse tools if license not ok.
 */
export function licenseMiddleware(projectId) {
  return async (req, res, next) => {
    const result = await checkLicense(projectId);
    if (!result.ok) {
      res.statusCode = 402;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "payment_required", ...result, pay_url: payUrl() }));
      return;
    }
    req.license = result;
    if (typeof next === "function") next();
  };
}
