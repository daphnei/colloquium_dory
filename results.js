import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { loadAdminEmails, isAdmin } from './config.js';

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

const loadingMsg   = document.getElementById('loading-msg');
const accessDenied = document.getElementById('access-denied');
const resultsPage  = document.getElementById('results-page');
const tbody        = document.getElementById('results-tbody');

// ═══════════════════════════════════════════════════════════
// SORT STATE
// ═══════════════════════════════════════════════════════════
let sortCol = 'score';
let sortDir = 'desc';   // 'asc' | 'desc'
let tableData = [];     // array of row objects, set after data loads

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not signed in — attempt Google sign-in (reuse the same popup flow)
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ hd: 'andrew.cmu.edu' });
      const result = await signInWithPopup(auth, provider);
      user = result.user;
    } catch {
      loadingMsg.textContent = 'Sign-in failed. Please visit the main page first.';
      return;
    }
  }

  await loadAdminEmails(db);
  if (!isAdmin(user.email)) {
    loadingMsg.classList.add('hidden');
    accessDenied.classList.remove('hidden');
    return;
  }

  await loadResults();
});

// ═══════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════
async function loadResults() {
  loadingMsg.textContent = 'Loading data...';

  // Load nominations and all user docs in parallel
  const [nomSnap, userSnap] = await Promise.all([
    getDocs(collection(db, 'nominations')),
    getDocs(collection(db, 'users')),
  ]);

  // Build user lookup: uid -> { role, displayName, hostAnswers }
  const userMap = {};
  userSnap.forEach(d => {
    userMap[d.id] = d.data();
  });

  // Build rows
  tableData = nomSnap.docs.map(d => {
    const nom = d.data();
    const votes = nom.votes || {};

    let score = 0, students = 0, faculty = 0, others = 0;

    for (const [uid, value] of Object.entries(votes)) {
      score += value;
      if (value !== 1) continue;   // only count upvotes per-category

      const role = userMap[uid]?.role ?? 'other';
      if (role === 'masters' || role === 'phd') {
        students++;
      } else if (role === 'professor' || role === 'postdoc') {
        faculty++;
      } else {
        others++;
      }
    }

    // Collect names of users who said "yes" to hosting this nomination
    const hostsYes = [];
    for (const [uid, userData] of Object.entries(userMap)) {
      if (userData.hostAnswers?.[d.id] === 'yes') {
        hostsYes.push(userData.displayName || userData.email || uid);
      }
    }

    return { id: d.id, name: nom.name, score, students, faculty, others, hostsYes, hidden: !!nom.hidden };
  });

  loadingMsg.classList.add('hidden');
  resultsPage.classList.remove('hidden');

  attachSortHandlers();
  renderTable();
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function renderTable() {
  const sorted = [...tableData].sort((a, b) => {
    const av = sortCol === 'name' ? a.name.toLowerCase() : a[sortCol];
    const bv = sortCol === 'name' ? b.name.toLowerCase() : b[sortCol];
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = '';
  for (const row of sorted) {
    const tr = document.createElement('tr');

    const scoreClass = row.score > 0 ? 'positive' : row.score < 0 ? 'negative' : '';

    const hostCells = row.hostsYes.length
      ? row.hostsYes.map(n => `<span>${escapeHtml(n)}</span>`).join('')
      : '<span style="background:var(--text-dim); opacity:0.6">none</span>';

    tr.innerHTML = `
      <td class="candidate-name">${escapeHtml(row.name)}</td>
      <td class="vote-score ${scoreClass}">${row.score}</td>
      <td class="vote-count">${row.students}</td>
      <td class="vote-count">${row.faculty}</td>
      <td class="vote-count">${row.others}</td>
      <td class="host-list">${hostCells}</td>
      <td class="vote-count">${row.hidden ? '🚫' : ''}</td>
    `;
    tbody.appendChild(tr);
  }

  // Update header sort indicators
  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

function attachSortHandlers() {
  document.querySelectorAll('thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      if (sortCol === th.dataset.col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = th.dataset.col;
        sortDir = th.dataset.col === 'name' ? 'asc' : 'desc';
      }
      renderTable();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
