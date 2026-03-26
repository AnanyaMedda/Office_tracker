// ============================================================
// Office Attendance Tracker — script.js
// ============================================================
//
// DATA MODEL (Firestore):
//   Collection : "attendance"
//   Document ID: "YYYY-MM-DD"   (e.g. "2026-03-21")
//   Fields     : { s: "O" | "W" | "L" }
//
//   "O" = Office
//   "W" = Work From Home
//   "L" = Leave
//
// Keeping only one short field ("s") minimises Firestore storage cost.
// ============================================================

// ── ❶ Firebase Configuration ────────────────────────────────
// Replace the values below with your own Firebase project config.
// You can find these in the Firebase Console:
//   Project Settings → Your apps → Firebase SDK snippet → Config
// ─────────────────────────────────────────────────────────────
// ⚠️  IMPORTANT: Update the values below before deploying!
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyApW_7EdKZtGWrv1yLvwraiSFJUkz9svhg",
  authDomain: "office-attendance-tracke-3f3db.firebaseapp.com",
  projectId: "office-attendance-tracke-3f3db",
  storageBucket: "office-attendance-tracke-3f3db.firebasestorage.app",
  messagingSenderId: "74594316196",
  appId: "1:74594316196:web:02f2aaaa343469a76e9b31"
};


// ── ❷ Initialise Firebase, Firestore & Auth ────────────────
let db = null;
let auth = null;
try {
  const app = firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  auth = firebase.auth();
} catch (e) {
  console.warn('Firebase init failed — running in offline/demo mode.', e);
}

// ── ❸ State ─────────────────────────────────────────────────
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();   // 0-indexed

// In-memory cache: key = "YYYY-MM-DD", value = "O" | "W" | "L"
let attendanceCache = {};

// Currently selected date string (for the modal)
let selectedDateStr = null;

// ── ❹ DOM references ─────────────────────────────────────────
const monthLabel = document.getElementById('month-label');
const daysGrid = document.getElementById('days-grid');
const prevBtn = document.getElementById('prev-month');
const nextBtn = document.getElementById('next-month');
const modalOverlay = document.getElementById('modal-overlay');
const modalDate = document.getElementById('modal-date');
const closeModal = document.getElementById('close-modal');
const officeBtnEl = document.getElementById('btn-office');
const wfhBtnEl = document.getElementById('btn-wfh');
const leaveBtnEl = document.getElementById('btn-leave');
const clearBtnEl = document.getElementById('btn-clear');
const loadingEl = document.getElementById('loading');
const toastEl = document.getElementById('toast');
// Auth UI
const loginOverlay = document.getElementById('login-overlay');
const googleSignIn = document.getElementById('btn-google-signin');
const signOutBtn = document.getElementById('btn-signout');
const userInfoEl = document.getElementById('user-info');
const userAvatarEl = document.getElementById('user-avatar');
const userNameEl = document.getElementById('user-name');
const loginErrorEl = document.getElementById('login-error');

// ── ❺ Fetch all attendance data from Firestore ──────────────
// Downloads every document from the "attendance" collection once
// and caches them in memory, so subsequent navigations are instant.
async function fetchAllAttendance() {
  if (!db) {
    // Firebase not configured — render the calendar without data
    showToast('ℹ️ Add your Firebase config to enable saving.');
    renderCalendar();
    return;
  }
  try {
    loadingEl.style.display = 'block';
    // getDocs returns all documents in the collection
    const snapshot = await db.collection('attendance').get();
    snapshot.forEach(doc => {
      // doc.id  = "YYYY-MM-DD"
      // doc.data() = { s: "O" | "W" | "L" }
      attendanceCache[doc.id] = doc.data().s;
    });
  } catch (err) {
    showToast('⚠️  Could not load data. Check Firebase config.');
    console.error('Firestore fetch error:', err);
  } finally {
    loadingEl.style.display = 'none';
    renderCalendar();
  }
}

// ── ❻ Save a single attendance entry to Firestore ────────────
// Uses .set() with the date as the document ID so that
// re-clicking a date overwrites the previous value (no duplicates).
// Minimal data: only the "s" field is stored.
async function saveAttendance(dateStr, status) {
  if (!db) {
    // No Firestore — save only in memory (lost on refresh)
    attendanceCache[dateStr] = status;
    showToast('✓ ' + statusLabel(status) + ' (not persisted — add Firebase config)');
    renderCalendar();
    return;
  }
  try {
    // Firestore path: attendance / "YYYY-MM-DD"
    await db.collection('attendance').doc(dateStr).set({ s: status });
    attendanceCache[dateStr] = status;          // update local cache
    showToast('✓ Saved ' + statusLabel(status));
    renderCalendar();
  } catch (err) {
    // Firestore failed — still update locally so the UI responds
    attendanceCache[dateStr] = status;
    showToast('✓ ' + statusLabel(status) + ' (saved locally — check Firebase config)');
    console.error('Firestore save error:', err);
    renderCalendar();
  }
}

// ── ❼ Delete an attendance entry from Firestore ──────────────
async function clearAttendance(dateStr) {
  if (!db) {
    delete attendanceCache[dateStr];
    showToast('Entry cleared.');
    renderCalendar();
    return;
  }
  try {
    await db.collection('attendance').doc(dateStr).delete();
    delete attendanceCache[dateStr];            // remove from cache
    showToast('Entry cleared.');
    renderCalendar();
  } catch (err) {
    // Firestore failed — still clear locally so the UI responds
    delete attendanceCache[dateStr];
    showToast('Entry cleared (locally — check Firebase config).');
    console.error('Firestore delete error:', err);
    renderCalendar();
  }
}

// ── ❽ Calendar rendering ─────────────────────────────────────
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const today = new Date();
const todayStr = formatDate(today.getFullYear(), today.getMonth(), today.getDate());

function renderCalendar() {
  // Update header label
  monthLabel.textContent = `${MONTHS[currentMonth]} ${currentYear}`;
  daysGrid.innerHTML = '';

  const firstDay = new Date(currentYear, currentMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Empty cells before day 1
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'day-cell empty';
    daysGrid.appendChild(empty);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDate(currentYear, currentMonth, d);
    const status = attendanceCache[dateStr];  // "O", "W", "L" or undefined

    const cell = document.createElement('div');
    cell.className = 'day-cell';
    cell.textContent = d;
    cell.setAttribute('data-date', dateStr);
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-label', `${d} ${MONTHS[currentMonth]} ${currentYear}`);

    // Highlight today
    if (dateStr === todayStr) cell.classList.add('today');

    // Apply status colour class
    if (status) {
      cell.classList.add('status-' + status);
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      cell.appendChild(dot);
    }

    cell.addEventListener('click', () => openModal(dateStr, d));
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') openModal(dateStr, d);
    });

    daysGrid.appendChild(cell);
  }
}

// ── ❾ Modal helpers ──────────────────────────────────────────
function openModal(dateStr, day) {
  selectedDateStr = dateStr;
  modalDate.textContent = `${day} ${MONTHS[currentMonth]} ${currentYear}`;

  // Show "clear" button only if a status already exists
  clearBtnEl.style.display = attendanceCache[dateStr] ? 'inline-block' : 'none';

  modalOverlay.classList.add('active');
}

function closeModalFn() {
  modalOverlay.classList.remove('active');
  selectedDateStr = null;
}

// ── ❿ Event Listeners ────────────────────────────────────────
prevBtn.addEventListener('click', () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
});

nextBtn.addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderCalendar();
});

// Status button clicks — save to Firestore then close modal
officeBtnEl.addEventListener('click', async () => {
  if (!selectedDateStr) return;
  await saveAttendance(selectedDateStr, 'O');
  closeModalFn();
});

wfhBtnEl.addEventListener('click', async () => {
  if (!selectedDateStr) return;
  await saveAttendance(selectedDateStr, 'W');
  closeModalFn();
});

leaveBtnEl.addEventListener('click', async () => {
  if (!selectedDateStr) return;
  await saveAttendance(selectedDateStr, 'L');
  closeModalFn();
});

clearBtnEl.addEventListener('click', async () => {
  if (!selectedDateStr) return;
  await clearAttendance(selectedDateStr);
  closeModalFn();
});

// Close modal when clicking outside it
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModalFn();
});

closeModal.addEventListener('click', closeModalFn);

// Keyboard: Escape closes the modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModalFn();
});

// ── ⓫ Utility functions ──────────────────────────────────────

// Zero-pad month/day and return "YYYY-MM-DD"
function formatDate(year, month, day) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

// Human-readable status label for toasts
function statusLabel(s) {
  return s === 'O' ? 'Office' : s === 'W' ? 'Work From Home' : 'Leave';
}

// Brief toast notification at the bottom of the screen
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

// ── ⓬ Auth: Sign-In / Sign-Out ───────────────────────────────
if (googleSignIn) {
  googleSignIn.addEventListener('click', async () => {
    if (!auth) {
      showToast('⚠️ Add your Firebase config to enable sign-in.');
      return;
    }
    loginErrorEl.style.display = 'none';
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch (err) {
      console.error('Sign-in error:', err);
      loginErrorEl.style.display = 'block';
    }
  });
}

if (signOutBtn) {
  signOutBtn.addEventListener('click', () => auth && auth.signOut());
}

// ── ⓭ Boot: Auth State Observer ──────────────────────────────
// This is the single entry point. Everything waits for auth state.
if (auth) {
  auth.onAuthStateChanged(user => {
    if (user) {
      // ── Signed IN ──
      loginOverlay.style.display = 'none';
      userInfoEl.style.display = 'flex';
      userAvatarEl.src = user.photoURL || '';
      userAvatarEl.style.display = user.photoURL ? 'block' : 'none';
      userNameEl.textContent = user.displayName || user.email;
      attendanceCache = {};          // clear any stale cache
      fetchAllAttendance();
    } else {
      // ── Signed OUT ──
      loginOverlay.style.display = 'flex';
      userInfoEl.style.display = 'none';
      attendanceCache = {};
      closeModalFn();
    }
  });
} else {
  // No Firebase config — run in demo mode without auth
  loginOverlay && (loginOverlay.style.display = 'none');
  fetchAllAttendance();
}
