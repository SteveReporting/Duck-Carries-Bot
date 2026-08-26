'use strict';

const fs = require('node:fs');
const path = require('node:path');

class SecurityStore {
  constructor(file, initialTrustedUsers = [], initialTrustedRoles = []) {
    this.file = file;
    this.state = {
      version: 1,
      maintenance: false,
      trustedUsers: [...initialTrustedUsers],
      trustedRoles: [...initialTrustedRoles],
      lockdown: { active: false, startedAt: null, reason: null, by: null, overwrites: {} },
      snapshot: null,
      incidentCounter: 0,
      recentIncidents: [],
    };
    this.load();
    this.mergeInitialTrust(initialTrustedUsers, initialTrustedRoles);
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state = {
        ...this.state,
        ...parsed,
        lockdown: { ...this.state.lockdown, ...(parsed.lockdown || {}) },
      };
    } catch (error) {
      console.error('[security-store] Could not read security state:', error);
    }
  }

  mergeInitialTrust(users, roles) {
    for (const id of users) {
      if (!this.state.trustedUsers.includes(id)) this.state.trustedUsers.push(id);
    }
    for (const id of roles) {
      if (!this.state.trustedRoles.includes(id)) this.state.trustedRoles.push(id);
    }
    this.save();
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  isTrustedUser(id) { return this.state.trustedUsers.includes(String(id)); }
  isTrustedRole(id) { return this.state.trustedRoles.includes(String(id)); }

  addTrustedUser(id) {
    id = String(id);
    if (!this.state.trustedUsers.includes(id)) this.state.trustedUsers.push(id);
    this.save();
  }

  removeTrustedUser(id) {
    id = String(id);
    this.state.trustedUsers = this.state.trustedUsers.filter((v) => v !== id);
    this.save();
  }

  addTrustedRole(id) {
    id = String(id);
    if (!this.state.trustedRoles.includes(id)) this.state.trustedRoles.push(id);
    this.save();
  }

  removeTrustedRole(id) {
    id = String(id);
    this.state.trustedRoles = this.state.trustedRoles.filter((v) => v !== id);
    this.save();
  }

  setMaintenance(enabled) {
    this.state.maintenance = Boolean(enabled);
    this.save();
  }

  setLockdown(lockdown) {
    this.state.lockdown = { ...this.state.lockdown, ...lockdown };
    this.save();
  }

  setSnapshot(snapshot) {
    this.state.snapshot = snapshot;
    this.save();
  }

  nextIncident(type, severity, data = {}) {
    this.state.incidentCounter += 1;
    const incident = {
      id: `INC-${new Date().getUTCFullYear()}-${String(this.state.incidentCounter).padStart(5, '0')}`,
      type,
      severity,
      createdAt: new Date().toISOString(),
      ...data,
    };
    this.state.recentIncidents.unshift(incident);
    this.state.recentIncidents = this.state.recentIncidents.slice(0, 100);
    this.save();
    return incident;
  }
}

module.exports = { SecurityStore };
