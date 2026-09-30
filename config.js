// Shared admin helpers — reads admin list from Firestore config/admins doc
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

let _adminEmails = null;

/**
 * Load the admin email list from the Firestore config/admins document.
 * Caches the result so subsequent calls are instant.
 */
export async function loadAdminEmails(db) {
  if (_adminEmails) return _adminEmails;
  try {
    const snap = await getDoc(doc(db, 'config', 'admins'));
    _adminEmails = snap.exists() ? (snap.data().emails || []) : [];
  } catch {
    // Non-admins can't read the config doc — that's expected
    _adminEmails = [];
  }
  return _adminEmails;
}

/**
 * Check whether an email is in the admin list.
 * Must call loadAdminEmails() first.
 */
export function isAdmin(email) {
  return _adminEmails?.includes(email) ?? false;
}
