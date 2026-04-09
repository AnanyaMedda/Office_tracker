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
// The configuration is now loaded from 'config.js'.
// Make sure 'config.js' is included in your index.html BEFORE script.js.
// ─────────────────────────────────────────────────────────────


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

// Signed-in user's UID — set by the auth observer
let currentUserId = null;

// New State for stats/filters
let activeFilter = 'all'; // 'all', 'O', 'W', 'L'
let currentView = 'calendar'; // 'calendar', 'list', 'cards'

// ── ❹ DOM references ─────────────────────────────────────────
const monthLabel = document.getElementById('month-label');
const daysGrid = document.getElementById('days-grid');
const weekdaysRow = document.querySelector('.weekdays');
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

// Stats and Filters
const statOfficeEl = document.getElementById('stat-office');
const statWfhEl = document.getElementById('stat-wfh');
const statLeaveEl = document.getElementById('stat-leave');
const filterChips = document.querySelectorAll('.filter-chip');
const viewToggle = document.getElementById('view-toggle');
const btnViewCalendar = document.getElementById('btn-view-calendar');
const btnViewList = document.getElementById('btn-view-list');
const btnViewCards = document.getElementById('btn-view-cards');
const listViewEl = document.getElementById('list-view');
const listBodyEl = document.getElementById('list-body');
const listEmptyEl = document.getElementById('list-empty');
const cardsViewEl = document.getElementById('cards-view');
const cardsGridEl = document.getElementById('cards-grid');
const cardsEmptyEl = document.getElementById('cards-empty');
const daysContainer = document.querySelector('.days-container');
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
    // Path: attendance/{userId} — subcollection of dates
    const snapshot = await db.collection('attendance').doc(currentUserId)
                              .collection('dates').get();
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
    refreshUI();
  }
}

// ── ❻ Master UI Refresh ──────────────────────────────────────
function refreshUI() {
  updateStats();
  if (currentView === 'calendar') {
    renderCalendar();
  } else if (currentView === 'list') {
    renderListView();
  } else {
    renderCardsView();
  }
}

function updateStats() {
  let counts = { O: 0, W: 0, L: 0 };
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDate(currentYear, currentMonth, d);
    const status = attendanceCache[dateStr];
    if (status && counts[status] !== undefined) {
      counts[status]++;
    }
  }

  statOfficeEl.textContent = counts.O;
  statWfhEl.textContent = counts.W;
  statLeaveEl.textContent = counts.L;
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
    // Path: attendance/{userId}/dates/{date}
    await db.collection('attendance').doc(currentUserId)
            .collection('dates').doc(dateStr).set({ s: status });
    attendanceCache[dateStr] = status;          // update local cache
    showToast('✓ Saved ' + statusLabel(status));
    refreshUI();
  } catch (err) {
    // Firestore failed — still update locally so the UI responds
    attendanceCache[dateStr] = status;
    showToast('✓ ' + statusLabel(status) + ' (saved locally — check Firebase config)');
    console.error('Firestore save error:', err);
    refreshUI();
  }
}

// ── ❽ Delete an attendance entry from Firestore ──────────────
async function clearAttendance(dateStr) {
  if (!db) {
    delete attendanceCache[dateStr];
    showToast('Entry cleared.');
    refreshUI();
    return;
  }
  try {
    // Path: attendance/{userId}/dates/{date}
    await db.collection('attendance').doc(currentUserId)
            .collection('dates').doc(dateStr).delete();
    delete attendanceCache[dateStr];            // remove from cache
    showToast('Entry cleared.');
    refreshUI();
  } catch (err) {
    // Firestore failed — still clear locally so the UI responds
    delete attendanceCache[dateStr];
    showToast('Entry cleared (locally — check Firebase config).');
    console.error('Firestore delete error:', err);
    refreshUI();
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
  // Update UI Visibility
  weekdaysRow.style.display = 'grid';
  daysContainer.style.display = 'block';
  listViewEl.style.display = 'none';
  cardsViewEl.style.display = 'none';

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
      
      // Filter logic: dim if not matching active filter
      if (activeFilter !== 'all' && status !== activeFilter) {
        cell.classList.add('dimmed');
      }
    } else if (activeFilter !== 'all') {
      // If a filter is active, empty days are also dimmed
      cell.classList.add('dimmed');
    }

    cell.addEventListener('click', () => openModal(dateStr, d));
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') openModal(dateStr, d);
    });

    daysGrid.appendChild(cell);
  }
}

// ── ❿ List View Rendering ─────────────────────────────────────
function renderListView() {
  weekdaysRow.style.display = 'none';
  daysContainer.style.display = 'none';
  listViewEl.style.display = 'block';
  cardsViewEl.style.display = 'none';
  
  monthLabel.textContent = `${MONTHS[currentMonth]} ${currentYear}`;
  listBodyEl.innerHTML = '';
  
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const entries = [];
  
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDate(currentYear, currentMonth, d);
    const status = attendanceCache[dateStr];
    if (status) {
      entries.push({ day: d, dateStr, status });
    }
  }
  
  if (entries.length === 0) {
    listEmptyEl.style.display = 'block';
    return;
  }
  
  listEmptyEl.style.display = 'none';
  entries.forEach(entry => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${entry.day} ${MONTHS[currentMonth].substring(0,3)}</td>
      <td>
        <span class="status-badge ${entry.status}">
          ${entry.status === 'O' ? '🏢 Office' : entry.status === 'W' ? '🏠 WFH' : '🌴 Leave'}
        </span>
      </td>
    `;
    listBodyEl.appendChild(row);
  });
}

// ── ⓫ Cards View Rendering ────────────────────────────────────
function renderCardsView() {
  weekdaysRow.style.display = 'none';
  daysContainer.style.display = 'none';
  listViewEl.style.display = 'none';
  cardsViewEl.style.display = 'block';
  
  monthLabel.textContent = `${MONTHS[currentMonth]} ${currentYear}`;
  cardsGridEl.innerHTML = '';
  
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const entries = [];
  
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDate(currentYear, currentMonth, d);
    const status = attendanceCache[dateStr];
    if (status) {
      entries.push({ day: d, dateStr, status });
    }
  }
  
  if (entries.length === 0) {
    cardsEmptyEl.style.display = 'block';
    return;
  }
  
  cardsEmptyEl.style.display = 'none';
  entries.forEach(entry => {
    const card = document.createElement('div');
    card.className = `status-card ${entry.status}`;
    
    let icon = entry.status === 'O' ? '🏢' : entry.status === 'W' ? '🏠' : '🌴';
    let label = entry.status === 'O' ? 'Office' : entry.status === 'W' ? 'WFH' : 'Leave';
    
    card.innerHTML = `
      <div class="status-icon">${icon}</div>
      <div class="card-date">${entry.day} ${MONTHS[currentMonth]}</div>
      <div class="card-status-text">${label}</div>
    `;
    
    card.addEventListener('click', () => openModal(entry.dateStr, entry.day));
    cardsGridEl.appendChild(card);
  });
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
  refreshUI();
});

nextBtn.addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  refreshUI();
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

// Filter chip clicks
filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.getAttribute('data-filter');
    renderCalendar(); // Filters only apply to calendar view
    
    // Auto-switch to calendar if user was in list view and clicks a filter
    if (currentView === 'list') {
      currentView = 'calendar';
      btnViewList.classList.remove('active');
      btnViewCalendar.classList.add('active');
      refreshUI();
    }
  });
});

// View toggle clicks
btnViewCalendar.addEventListener('click', () => {
  setView('calendar');
});

btnViewList.addEventListener('click', () => {
  setView('list');
});

btnViewCards.addEventListener('click', () => {
  setView('cards');
});

function setView(view) {
  currentView = view;
  
  // Update buttons
  btnViewCalendar.classList.toggle('active', view === 'calendar');
  btnViewList.classList.toggle('active', view === 'list');
  btnViewCards.classList.toggle('active', view === 'cards');
  
  refreshUI();
}

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
      currentUserId = user.uid;      // store UID for all Firestore paths
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
