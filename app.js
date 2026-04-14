// ═══════════════════════════════════════════════════════════
// FIREBASE CONFIG — Replace with your project's config object
// ═══════════════════════════════════════════════════════════
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  getDocs,
  deleteDoc,
  collection,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─────────────────────────────────────────────────────────────
// TODO: Replace the config below with your Firebase project's
// config from the Firebase Console → Project Settings → General
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCNsrH-UIMUCfNXPXmJ60MjWbwR78osMKg",
  authDomain: "dei-lab.firebaseapp.com",
  projectId: "dei-lab",
  storageBucket: "dei-lab.firebasestorage.app",
  messagingSenderId: "802374347260",
  appId: "1:802374347260:web:b9b52e39382302db436a79",
  measurementId: "G-FF2TPKBQEM"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, 'lticolloq');

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let currentUser = null;   // Firebase auth user
let currentRole = null;   // string: masters | phd | postdoc | professor | other
let myHostAnswers = {};      // nominationId -> answer, loaded from user's own doc
let nominations = [];        // array of nomination objects
let pendingVoteId = null;    // nominationId waiting for professor host-confirmation
let pendingHostEditOnly = false; // true when modal is opened to edit pref, not to vote
let sortOrder = 'hot';       // 'hot' | 'name' | 'recent'

// ═══════════════════════════════════════════════════════════
// REDDIT HOT ALGORITHM (JS port)
// score = ups - downs
// order = log10(max(|score|, 1))
// sign  = 1 | -1 | 0
// seconds = epochSeconds(date) - 1134028003
// hot = round(order + sign * seconds / 45000, 7)
// ═══════════════════════════════════════════════════════════
function hotScore(ups, downs, date) {
  const s = ups - downs;
  const order = Math.log10(Math.max(Math.abs(s), 1));
  const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
  const seconds = (date instanceof Date ? date.getTime() : date.toDate().getTime()) / 1000 - 1134028003;
  return Math.round((order + sign * seconds / 45000) * 1e7) / 1e7;
}

// ═══════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');

const loginBtn = document.getElementById('google-login-btn');
const loginError = document.getElementById('login-error');

const roleModal = document.getElementById('role-modal');
const roleConfirm = document.getElementById('role-confirm-btn');

const nominateModal = document.getElementById('nominate-modal');
const nominateBtn = document.getElementById('nominate-btn');
const nominateSubmit = document.getElementById('nominate-submit-btn');
const nominateError = document.getElementById('nominate-error');
const hostSection = document.getElementById('nominate-host-section');

const hostModal = document.getElementById('host-modal');
const hostModalCancel = document.getElementById('host-modal-cancel');
const hostModalConfirm = document.getElementById('host-modal-confirm');
const hostModalError = document.getElementById('host-modal-error');

const sortSelect = document.getElementById('sort-select');
const nomList = document.getElementById('nominations-list');
const nomEmpty = document.getElementById('nominations-empty');
const refreshBtn = document.getElementById('refresh-btn');
const refreshIcon = document.getElementById('refresh-icon');
const signoutBtn = document.getElementById('signout-btn');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const userRoleBadge = document.getElementById('user-role-badge');
const loadingOverlay = document.getElementById('loading-overlay');

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideError(el) { el.classList.add('hidden'); }

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// Close modals on backdrop click
['nominate-modal', 'host-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target === document.getElementById(id)) closeModal(id);
  });
});

// Close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

function showApp() {
  loginScreen.classList.add('hidden');
  loginScreen.classList.remove('active');
  appScreen.classList.remove('hidden');
  appScreen.classList.add('active');
}

function showLogin() {
  appScreen.classList.add('hidden');
  appScreen.classList.remove('active');
  loginScreen.classList.remove('hidden');
  loginScreen.classList.add('active');
}

function setRefreshing(active) {
  if (active) {
    refreshIcon.classList.add('spinning');
    refreshBtn.disabled = true;
  } else {
    refreshIcon.classList.remove('spinning');
    refreshBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════


loginBtn.addEventListener('click', async () => {
  hideError(loginError);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: 'andrew.cmu.edu' });
  try {
    const result = await signInWithPopup(auth, provider);
    if (!result.user.email.endsWith('@andrew.cmu.edu')) {
      await signOut(auth);
      showError(loginError, 'Only @andrew.cmu.edu accounts are allowed.');
    }
  } catch (err) {
    showError(loginError, 'Sign-in failed: ' + err.message);
  }
});

signoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  // Hide loading overlay on first auth state resolution
  loadingOverlay.style.display = 'none';
  console.log('[auth] onAuthStateChanged fired. user:', user ? user.email : null);

  if (user && user.email.endsWith('@andrew.cmu.edu')) {
    currentUser = user;
    userAvatar.src = user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName || user.email);
    userName.textContent = user.displayName || user.email.split('@')[0];

    console.log('[firestore] YAAAAAAAAAY! Got here!!!!')
    // Check Firestore for existing role
    try {
      console.log('[firestore] Fetching user doc...');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      console.log('[firestore] User doc exists:', userDoc.exists());
      if (userDoc.exists() && userDoc.data().role) {
        currentRole = userDoc.data().role;
        myHostAnswers = userDoc.data().hostAnswers || {};
        userRoleBadge.textContent = currentRole;
        showApp();
        await loadNominations();
      } else {
        // First login — ask for role
        showApp();
        openModal('role-modal');
      }
    } catch (err) {
      console.error('[firestore] Error fetching user doc:', err);
      showLogin();
      showError(loginError,
        '⚠️ Database error: ' + err.message +
        ' — Check that Firestore is enabled and security rules are published.');
      await signOut(auth);
    }
  } else {
    currentUser = null;
    currentRole = null;
    myHostAnswers = {};
    nominations = [];
    showLogin();
  }
});

// ═══════════════════════════════════════════════════════════
// ROLE SELECTION
// ═══════════════════════════════════════════════════════════
document.querySelectorAll('input[name="role"]').forEach(radio => {
  radio.addEventListener('change', () => {
    roleConfirm.disabled = false;
  });
});

roleConfirm.addEventListener('click', async () => {
  const selected = document.querySelector('input[name="role"]:checked');
  if (!selected) return;
  const role = selected.value;
  try {
    await setDoc(doc(db, 'users', currentUser.uid), {
      email: currentUser.email,
      displayName: currentUser.displayName || '',
      role,
    });
    currentRole = role;
    userRoleBadge.textContent = role;
    closeModal('role-modal');
    await loadNominations();
  } catch (err) {
    console.error('Error saving role:', err);
  }
});

// ═══════════════════════════════════════════════════════════
// NOMINATE
// ═══════════════════════════════════════════════════════════
nominateBtn.addEventListener('click', () => {
  // Reset form
  document.getElementById('nominee-name').value = '';
  document.getElementById('nominee-affiliation').value = '';
  document.getElementById('nominee-url').value = '';
  document.getElementById('nominee-reason').value = '';
  document.querySelectorAll('input[name="nominate-host"]').forEach(r => r.checked = false);
  hideError(nominateError);

  // Show professor host question (always — it's per-nominee)
  if (currentRole === 'professor') {
    hostSection.classList.remove('hidden');
  } else {
    hostSection.classList.add('hidden');
  }

  openModal('nominate-modal');
});

nominateSubmit.addEventListener('click', async () => {
  const name = document.getElementById('nominee-name').value.trim();
  const affiliation = document.getElementById('nominee-affiliation').value.trim();
  const url = document.getElementById('nominee-url').value.trim();
  const reason = document.getElementById('nominee-reason').value.trim();

  if (!name || !affiliation || !url) {
    showError(nominateError, 'Please fill in all required fields.');
    return;
  }

  // Basic URL validation — must be http or https to prevent javascript: injection
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
  } catch {
    showError(nominateError, 'Please enter a valid URL (e.g. https://example.com).');
    return;
  }

  // Duplicate check — same name (case-insensitive)
  const duplicate = nominations.find(n =>
    n.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    const proceed = confirm(`A nomination already exists for "${duplicate.name}." Are you sure you want to proceed with a new nomination?`);
    if (!proceed) return;
  }

  let hostWillingness = null;
  if (currentRole === 'professor') {
    const hostPick = document.querySelector('input[name="nominate-host"]:checked');
    if (!hostPick) {
      showError(nominateError, 'Please indicate whether you would be willing to host this speaker.');
      return;
    }
    hostWillingness = hostPick.value;
  }

  nominateSubmit.disabled = true;
  nominateSubmit.textContent = 'Submitting…';

  try {
    // Create the nomination doc — host answers are NOT stored here (privacy: stored in user doc instead)
    const newNomRef = await addDoc(collection(db, 'nominations'), {
      name,
      affiliation,
      url,
      reason,
      nominatedBy: currentUser.uid,
      nominatedByName: currentUser.displayName || currentUser.email.split('@')[0],
      nominatedAt: serverTimestamp(),
      votes: { [currentUser.uid]: 1 },
    });
    if (hostWillingness) {
      // Store the professor's host answer privately in their own user doc,
      // keyed by nomination ID. Only they can read their own user doc.
      myHostAnswers[newNomRef.id] = hostWillingness;
      await updateDoc(doc(db, 'users', currentUser.uid), {
        [`hostAnswers.${newNomRef.id}`]: hostWillingness,
      });
    }
    closeModal('nominate-modal');
    await loadNominations();
  } catch (err) {
    showError(nominateError, 'Error submitting nomination: ' + err.message);
  } finally {
    nominateSubmit.disabled = false;
    nominateSubmit.textContent = 'Submit Nomination';
  }
});

// ═══════════════════════════════════════════════════════════
// LOAD & RENDER NOMINATIONS
// ═══════════════════════════════════════════════════════════
async function loadNominations() {
  try {
    const snapshot = await getDocs(collection(db, 'nominations'));
    nominations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNominations();
  } catch (err) {
    console.error('Error loading nominations:', err);
  }
}

function renderNominations() {
  const sorted = [...nominations].sort((a, b) => {
    if (sortOrder === 'name') {
      return a.name.localeCompare(b.name);
    } else if (sortOrder === 'recent') {
      // aDate = the date nomination a was submitted
      // bDate = the date nomination b was submitted
      // Firestore timestamps expose .toDate(); plain Date objects are used as a fallback
      const aDate = a.nominatedAt ? (a.nominatedAt.toDate ? a.nominatedAt.toDate() : new Date(a.nominatedAt)) : new Date(0);
      const bDate = b.nominatedAt ? (b.nominatedAt.toDate ? b.nominatedAt.toDate() : new Date(b.nominatedAt)) : new Date(0);
      // Subtract aDate from bDate so that more recently nominated candidates appear first
      return bDate - aDate;
    } else {
      // Reddit hot score, which combines vote score with nomination time
      const aUps = Object.values(a.votes || {}).filter(v => v === 1).length;
      const aDowns = Object.values(a.votes || {}).filter(v => v === -1).length;
      const aDate = a.nominatedAt ? (a.nominatedAt.toDate ? a.nominatedAt.toDate() : new Date(a.nominatedAt)) : new Date(0);

      const bUps = Object.values(b.votes || {}).filter(v => v === 1).length;
      const bDowns = Object.values(b.votes || {}).filter(v => v === -1).length;
      const bDate = b.nominatedAt ? (b.nominatedAt.toDate ? b.nominatedAt.toDate() : new Date(b.nominatedAt)) : new Date(0);

      return hotScore(bUps, bDowns, bDate) - hotScore(aUps, aDowns, aDate);
    }
  });

  nomList.innerHTML = '';

  if (sorted.length === 0) {
    nomEmpty.classList.remove('hidden');
    return;
  }
  nomEmpty.classList.add('hidden');

  const template = document.getElementById('card-template');
  sorted.forEach(nom => {
    const votes = nom.votes || {};
    const ups = Object.values(votes).filter(v => v === 1).length;
    const downs = Object.values(votes).filter(v => v === -1).length;
    const net = ups - downs;
    const myVote = currentUser ? (votes[currentUser.uid] ?? 0) : 0;

    const card = template.content.cloneNode(true);
    const el = card.querySelector('.nominee-card');
    el.dataset.id = nom.id;

    el.querySelector('.card-name').textContent = nom.name;
    el.querySelector('.card-affiliation').textContent = 'Affiliation: ' + nom.affiliation;
    const urlEl = el.querySelector('.card-url');
    urlEl.href = nom.url;
    urlEl.textContent = nom.url;

    const reasonEl = el.querySelector('.card-reason');
    if (nom.reason) {
      reasonEl.textContent = nom.reason;
      reasonEl.classList.remove('hidden');
    }

    const scoreEl = el.querySelector('.vote-score');
    scoreEl.textContent = net;
    scoreEl.className = 'vote-score' + (net > 0 ? ' positive' : net < 0 ? ' negative' : '');

    // Nominated-by
    el.querySelector('.card-nominated-by').textContent = 'Nominated by ' + (nom.nominatedByName || 'someone');

    // Host tag — read from local myHostAnswers (backed by user's private user doc, not the nomination doc)
    const myHostAnswer = myHostAnswers[nom.id] ?? null;
    if (currentRole === 'professor') {
      const tag = el.querySelector('.card-host-tag');
      tag.classList.remove('hidden');
      tag.style.cursor = 'pointer';
      if (myHostAnswer) {
        tag.classList.add('card-host-tag--' + myHostAnswer);
        const labels = {
          yes: 'You put "yes" to hosting.',
          maybe: 'You put "maybe" to hosting.',
          no: 'You put "no" to hosting.'
        };
        tag.textContent = labels[myHostAnswer] || '';
        tag.title = 'Click to change';
      } else {
        tag.classList.add('card-host-tag--unanswered');
        tag.textContent = 'Are you interested in hosting?';
      }
      tag.addEventListener('click', () => {
        // Read live value from myHostAnswers (not the closure) so yes-lock is always current
        const currentAnswer = myHostAnswers[nom.id] ?? null;
        pendingVoteId = nom.id;
        pendingHostEditOnly = true;
        const locked = currentAnswer === 'yes';
        document.querySelectorAll('input[name="upvote-host"]').forEach(r => {
          r.checked = r.value === currentAnswer;
          r.disabled = locked;
        });
        hostModalConfirm.disabled = locked;
        hideError(hostModalError);
        openModal('host-modal');
      });
    }

    // Vote buttons
    const upBtn = el.querySelector('.upvote-btn');
    const downBtn = el.querySelector('.downvote-btn');

    if (myVote === 1) { upBtn.classList.add('active'); }
    if (myVote === -1) { downBtn.classList.add('active'); }

    upBtn.addEventListener('click', () => handleVote(nom.id, 1));
    downBtn.addEventListener('click', () => handleVote(nom.id, -1));

    if (currentUser?.email === 'dippolit@andrew.cmu.edu') {
      const deleteBtn = el.querySelector('.delete-btn');
      deleteBtn.classList.remove('hidden');
      deleteBtn.addEventListener('click', () => handleDelete(nom.id));
    }

    nomList.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════
// VOTING
// ═══════════════════════════════════════════════════════════
async function handleVote(nominationId, direction) {
  if (!currentUser) return;

  const nom = nominations.find(n => n.id === nominationId);
  if (!nom) return;
  const votes = nom.votes || {};
  const myVote = votes[currentUser.uid] ?? 0;

  // Compute the new vote value (toggle off if same direction)
  const newVote = myVote === direction ? 0 : direction;

  // Professors upvoting get the host question unless they've already answered for this nominee
  if (currentRole === 'professor' && newVote === 1) {
    const existingAnswer = myHostAnswers[nominationId];
    if (existingAnswer) {
      await applyVote(nominationId, newVote, existingAnswer);
      return;
    }
    pendingVoteId = nominationId;
    document.querySelectorAll('input[name="upvote-host"]').forEach(r => { r.checked = false; r.disabled = false; });
    hostModalConfirm.disabled = false;
    hideError(hostModalError);
    openModal('host-modal');
    return;
  }

  await applyVote(nominationId, newVote, null);
}

hostModalCancel.addEventListener('click', () => {
  pendingVoteId = null;
  pendingHostEditOnly = false;
  document.querySelectorAll('input[name="upvote-host"]').forEach(r => { r.disabled = false; });
  hostModalConfirm.disabled = false;
  closeModal('host-modal');
});

hostModalConfirm.addEventListener('click', async () => {
  const hostPick = document.querySelector('input[name="upvote-host"]:checked');
  if (!hostPick) {
    showError(hostModalError, 'Please select an answer to continue.');
    return;
  }

  hostModalConfirm.disabled = true;
  try {
    if (pendingHostEditOnly) {
      // Just update the host preference, don't touch the vote.
      // Write privately to the professor's own user doc — not the nomination doc.
      myHostAnswers[pendingVoteId] = hostPick.value;
      await updateDoc(doc(db, 'users', currentUser.uid), {
        [`hostAnswers.${pendingVoteId}`]: hostPick.value,
      });
      updateHostTag(pendingVoteId, hostPick.value);
    } else {
      await applyVote(pendingVoteId, 1, hostPick.value);
    }
    closeModal('host-modal');
    pendingVoteId = null;
    pendingHostEditOnly = false;
  } catch (err) {
    showError(hostModalError, 'Error recording vote: ' + err.message);
  } finally {
    hostModalConfirm.disabled = false;
  }
});

function updateHostTag(nominationId, answer) {
  const cardEl = nomList.querySelector(`.nominee-card[data-id="${nominationId}"]`);
  if (!cardEl) return;
  const tag = cardEl.querySelector('.card-host-tag');
  const labels = {
    yes: 'You put "yes" to hosting.',
    maybe: 'You put "maybe" to hosting.',
    no: 'You put "no" to hosting.'
  };
  tag.className = 'card-host-tag card-host-tag--' + answer;
  tag.textContent = labels[answer] || '';
}

async function applyVote(nominationId, newVote, hostWillingness) {
  const uid = currentUser.uid;
  const ref = doc(db, 'nominations', nominationId);

  // Build updated votes map from local state
  const nom = nominations.find(n => n.id === nominationId);
  const votes = { ...(nom.votes || {}) };

  if (newVote === 0) {
    delete votes[uid];
  } else {
    votes[uid] = newVote;
  }

  // Only votes go on the nomination doc — host answers stay private in the user doc
  await updateDoc(ref, { votes });

  if (hostWillingness !== null) {
    // Store host answer privately in the professor's own user doc
    myHostAnswers[nominationId] = hostWillingness;
    await updateDoc(doc(db, 'users', uid), {
      [`hostAnswers.${nominationId}`]: hostWillingness,
    });
    updateHostTag(nominationId, hostWillingness);
  }

  // Update local vote state immediately for snappy UI
  nom.votes = votes;

  // Update only the affected card's vote display — don't re-sort
  const el = nomList.querySelector(`.nominee-card[data-id="${nominationId}"]`);
  if (el) {
    const ups = Object.values(votes).filter(v => v === 1).length;
    const downs = Object.values(votes).filter(v => v === -1).length;
    const net = ups - downs;
    const myVote = votes[uid] ?? 0;

    const scoreEl = el.querySelector('.vote-score');
    scoreEl.textContent = net;
    scoreEl.className = 'vote-score' + (net > 0 ? ' positive' : net < 0 ? ' negative' : '');

    el.querySelector('.upvote-btn').classList.toggle('active', myVote === 1);
    el.querySelector('.downvote-btn').classList.toggle('active', myVote === -1);
  }
}

// ═══════════════════════════════════════════════════════════
// DELETE (dippolit only)
// ═══════════════════════════════════════════════════════════
async function handleDelete(nominationId) {
  if (!confirm('Delete this nomination? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(db, 'nominations', nominationId));
    nominations = nominations.filter(n => n.id !== nominationId);
    renderNominations();
  } catch (err) {
    console.error('❌ Delete failed:', err);
    alert('Delete failed: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
sortSelect.addEventListener('change', () => {
  sortOrder = sortSelect.value;
  renderNominations();
});

refreshBtn.addEventListener('click', async () => {
  setRefreshing(true);
  await loadNominations();
  setRefreshing(false);
});
