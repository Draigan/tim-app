# Matrix Droplet — Security Audit (2026-07-02)

**Host:** `matrix` (DigitalOcean droplet, access via `ssh matrix`)
**OS:** Ubuntu 25.10 (Questing Quokka), kernel 6.17.0-5-generic
**Login:** root only, key-only (ed25519, `draigan.lefebvre@gmail.com`)
**Audit type:** read-only. Nothing was changed on the server.

> **Status: all findings remediated 2026-07-03.** See the
> [Remediation Log](#remediation-log-2026-07-03) at the bottom for what was done.

---

## Summary

Reasonably tight box. Key-only SSH, `ufw` default-deny, only 22/80/443 exposed,
no Docker, no world-writable files, no extra UID-0 accounts, no empty passwords,
minimal/standard SUID set (16, all normal), TLS certs valid and auto-renewing via
certbot. Findings below are hardening gaps, **not** signs of active compromise.

Roles observed: reverse-proxy host for multiple sites/apps —
`api.lodestonesystems.ca`, `app.timberfell.ca`, `dashboard/demo/fetch.lodestonesystems.ca`,
`draigan.com`, `phoenix.draigan.com`, `kawarthatechcare.ca`, `timberfell.ca`,
`timberfellstorage.ca`, plus a Node backend.

---

## Findings

### 🔴 High
1. **Backend runs as root.** — ✅ **RESOLVED 2026-07-03**
   `node /root/spawn-backend/server.js` (was PID 3147490) listens on `*:3001` as **root**.
   Not internet-exposed (ufw blocks 3001; nginx reverse-proxies to `127.0.0.1:3001`),
   but any RCE in the Node app = full root.
   **Fix:** run under a dedicated unprivileged service user via a systemd unit.

### 🟠 Medium
2. **Heavy SSH brute-force + no fail2ban.** — ✅ **RESOLVED 2026-07-03**
   ~19,400 failed/invalid SSH auths in the journal over 7 days. Password auth is
   off (key-only) so they can't get in, but there's no rate-limiting.
   **Fix:** install/configure `fail2ban`, or restrict port 22 to known source IPs.

3. **Reboot pending + ~30 upgradable packages.** — ✅ **RESOLVED 2026-07-03**
   `*** System restart required ***` was set (staged kernel/library updates incl.
   `apparmor`, `cloud-init`, `coreutils`, `initramfs-tools`). `unattended-upgrades`
   IS enabled (good), but a reboot is needed to activate the new kernel.
   **Fix:** `apt update && apt upgrade`, then schedule a reboot.

4. **`PermitRootLogin yes`.** — ✅ **RESOLVED 2026-07-03** (set to `prohibit-password`)
   Mitigated by `passwordauthentication no` (effectively key-only root). Root is the
   only login account.
   **Fix:** create a non-root sudo user, then set `PermitRootLogin prohibit-password`
   (or `no`).

### 🟡 Low
5. **`.env` world-readable (644).** — ✅ **RESOLVED 2026-07-03**
   `/root/spawn-backend/.env` (secrets) is `-rw-r--r--`. Protected today only because
   `/root` is `700`.
   **Fix:** `chmod 600 /root/spawn-backend/.env`.

6. **Orphaned ownership.** Many `spawn-backend` files owned by UID/GID `1000` with no
   matching user in `/etc/passwd`. Cosmetic. Reconcile if a service user is created.
   — ✅ **RESOLVED 2026-07-03** (production copy at `/opt/spawn-backend` now owned by
   `spawn`; old `/root/spawn-backend` copy retained as rollback, to be deleted).

7. **`x11forwarding yes`** on a headless server — unnecessary attack surface.
   **Fix:** set `X11Forwarding no` in sshd config. — ✅ **RESOLVED 2026-07-03**

---

## What's already good ✅
- Key-only auth, correct `.ssh` perms (dir 700, keys 600)
- `ufw` active, default deny incoming, only 22/80/443 open
- nginx default-server catch-all (`return 444` / `ssl_reject_handshake on`)
- Port 3001 bound but firewalled off from the internet
- 13 Let's Encrypt certs valid through Aug–Sep 2026, certbot auto-renew in cron
- `chronyd` time sync, `unattended-upgrades` enabled
- No Docker, no world-writable files, no non-standard SUID, no empty-password accounts

---

## Suggested remediation order (do yourself / review first)
1. `chmod 600 /root/spawn-backend/.env`  *(instant, safe)*
2. Install fail2ban (`apt install fail2ban`, default sshd jail)
3. `apt update && apt upgrade` → schedule reboot to load new kernel
4. Create `spawn` service user, move backend to a systemd unit running as that user
5. Harden sshd: `X11Forwarding no`, and `PermitRootLogin prohibit-password` once a
   sudo user exists. Reload sshd and confirm a second session before closing.

## How this audit was run
Connected via `ssh matrix` and ran read-only checks: `sshd -T`, `/etc/passwd` +
`/etc/shadow`, `ufw status`, `nft/iptables -L`, `ss -tulpn`, `apt -s upgrade`,
cron dirs, `journalctl` for SSH auth, `find` for SUID/world-writable, cert
`openssl x509 -enddate`, and process/cwd inspection of the `:3001` listener.

---

## Remediation Log (2026-07-03)

All seven findings were remediated in one session. Each change was verified before
moving on; `app.timberfell.ca` returned HTTP 200 after every step.

| # | Finding | Fix applied | Verification |
|---|---------|-------------|--------------|
| 5 | `.env` 644 | `chmod 600` (now owned by `spawn`) | `-rw-------` |
| 2 | No fail2ban | Installed `fail2ban`; `sshd` jail enabled (5 retries → 1h ban), admin IP whitelisted in `ignoreip` | `fail2ban-client status sshd` active + enabled |
| 3 | Reboot + stale pkgs | `apt upgrade` (kernel → **6.17.0-40-generic**), rebooted | `reboot-required` cleared; all services auto-recovered |
| 1 🔴 | Backend as root | Copied app to `/opt/spawn-backend`, Node runtime to `/opt/nodejs`; created `spawn` system user (uid 997, nologin); new **systemd unit** `spawn-backend.service` runs as `spawn` with sandboxing (`ProtectSystem=strict`, `NoNewPrivileges`, etc.); removed from PM2 | No Node process runs as root; `:3001` owned by `spawn`; service `enabled` |
| 6 | Orphaned uid 1000 | Production copy owned by `spawn`; old `/root/spawn-backend` kept as rollback | `ls -l` shows `spawn:spawn` |
| 4 | `PermitRootLogin yes` | Drop-in `/etc/ssh/sshd_config.d/99-hardening.conf` → `prohibit-password` | `sshd -T`; fresh key login as root confirmed |
| 7 | `X11Forwarding yes` | Same drop-in → `X11Forwarding no` | `sshd -T` |

**Related change (client side):** `spawn/hub/backend` `package.json` deploy script
updated to rsync to `/opt/spawn-backend/` with `--chown=spawn:spawn` and restart via
`systemctl restart spawn-backend` (was PM2). Tested end-to-end.

**Rollback nets left in place:** old app copy `/root/spawn-backend`; sshd backup
`/etc/ssh/sshd_config.bak-20260703`; PM2 still installed.

**Optional follow-ups (not yet done):**
- Delete `/root/spawn-backend` once the new setup is proven over a few days.
- Fully remove PM2 (`pm2 kill` + disable `pm2-root`) to drop the last root-owned
  Node process (`pm2-logrotate`, not network-exposed).
- Investigate the backend's pre-migration restart count (`↺ 84`) for a possible
  crash loop / memory issue.
