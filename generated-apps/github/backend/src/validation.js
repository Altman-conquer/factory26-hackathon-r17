const USERNAME_RE = /^(?=.{1,39}$)[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const TEAM_NAME_RE = /^(?=.{1,50}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLE_VALUES = ['Read', 'Triage', 'Write', 'Maintain', 'Admin'];
const ORGANIZATION_ROLE_VALUES = ['Member', 'Owner'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidUsername(value) {
  return typeof value === 'string' && USERNAME_RE.test(value);
}

function normalizeOrganizationName(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isValidOrganizationName(value) {
  return isValidUsername(value);
}

function isValidTeamName(value) {
  return typeof value === 'string' && TEAM_NAME_RE.test(value);
}

function isValidPassword(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (value.length < 12 || value.length > 128) {
    return false;
  }
  if (/\s/.test(value)) {
    return false;
  }
  if (!/[A-Z]/.test(value)) {
    return false;
  }
  if (!/[a-z]/.test(value)) {
    return false;
  }
  if (!/[0-9]/.test(value)) {
    return false;
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return false;
  }
  return true;
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isValidEmail(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length === 0 || trimmed.length > 254) {
    return false;
  }
  if (trimmed.includes(' ') || trimmed.includes('\t') || trimmed.includes('\n')) {
    return false;
  }
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf('@')) {
    return false;
  }
  const domain = trimmed.slice(atIndex + 1);
  if (!domain.includes('.')) {
    return false;
  }
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

function isDisplayNameValid(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length >= 1 && trimmed.length <= 100;
}

function normalizeRole(value, fallback = 'Member') {
  const role = String(value ?? fallback).trim();
  const match = ROLE_VALUES.find((candidate) => candidate.toLowerCase() === role.toLowerCase());
  return match || null;
}

function normalizeOrganizationRole(value, fallback = 'Member') {
  const role = String(value ?? fallback).trim();
  const match = ORGANIZATION_ROLE_VALUES.find((candidate) => candidate.toLowerCase() === role.toLowerCase());
  return match || null;
}

module.exports = {
  USERNAME_RE,
  TEAM_NAME_RE,
  ROLE_VALUES,
  ORGANIZATION_ROLE_VALUES,
  isNonEmptyString,
  isValidUsername,
  normalizeOrganizationName,
  isValidOrganizationName,
  isValidTeamName,
  isValidPassword,
  normalizeEmail,
  isValidEmail,
  isDisplayNameValid,
  normalizeRole,
  normalizeOrganizationRole,
};
