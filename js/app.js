import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import firebaseConfig from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// App State
let currentUser = null;
let isLoginMode = true;

// Modal Transitions
window.openModal = function () {
    document.getElementById('loginModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

window.closeModal = function () {
    document.getElementById('loginModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

// Close modal when clicking outside
window.onclick = function (event) {
    const modal = document.getElementById('loginModal');
    if (event.target == modal) {
        closeModal();
    }
}

window.toggleAuthMode = function () {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('modalTitle');
    const nameGroup = document.getElementById('nameGroup');
    const submitBtn = document.getElementById('authSubmitBtn');
    const toggleText = document.getElementById('authToggleText');

    if (isLoginMode) {
        title.innerText = 'Client Login';
        nameGroup.style.display = 'none';
        submitBtn.innerText = 'Sign In';
        toggleText.innerHTML = 'Don\'t have an account? <a href="javascript:void(0)" onclick="toggleAuthMode()" style="color: var(--primary-navy); font-weight: 600;">Register</a>';
    } else {
        title.innerText = 'Create Account';
        nameGroup.style.display = 'block';
        submitBtn.innerText = 'Register';
        toggleText.innerHTML = 'Already have an account? <a href="javascript:void(0)" onclick="toggleAuthMode()" style="color: var(--primary-navy); font-weight: 600;">Login</a>';
    }
}

// Real Firebase Auth
window.handleAuth = async function (event) {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('authSubmitBtn');

    submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
    submitBtn.disabled = true;

    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
        }
        closeModal();
    } catch (error) {
        console.error('Auth error:', error);
        alert('Authentication failed: ' + error.message);
    } finally {
        submitBtn.innerHTML = isLoginMode ? 'Sign In' : 'Register';
        submitBtn.disabled = false;
    }
}

// Observe Auth State
onAuthStateChanged(auth, (user) => {
    const loginBtn = document.getElementById('loginBtn');
    if (user) {
        currentUser = user;
        loginBtn.innerHTML = user.email.split('@')[0];
        loginBtn.style.background = '#E8F5E9';
        loginBtn.style.color = '#2E7D32';
        unlockPremium();
    } else {
        currentUser = null;
        loginBtn.innerHTML = 'Client Login';
        loginBtn.style.background = '';
        loginBtn.style.color = '';
        lockPremium();
    }
});

function unlockPremium() {
    document.getElementById('login-overlay').style.display = 'none';
    const lockedCols = document.querySelectorAll('.locked-data');
    lockedCols.forEach(col => col.classList.add('unlocked'));
}

function lockPremium() {
    document.getElementById('login-overlay').style.display = 'block';
    const lockedCols = document.querySelectorAll('.locked-data');
    lockedCols.forEach(col => col.classList.remove('unlocked'));
}

// Fetch Live Cases from Firestore
async function fetchCases(filterText = "") {
    const tableBody = document.querySelector('tbody');
    try {
        const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'), limit(20));
        const querySnapshot = await getDocs(q);

        tableBody.innerHTML = ''; // Clear previous data

        let found = false;
        querySnapshot.forEach((doc) => {
            const data = doc.data();

            // Search Filtering (Local for performance)
            if (filterText) {
                const searchLower = filterText.toLowerCase();
                const matches =
                    (data.caseFileNo && data.caseFileNo.toLowerCase().includes(searchLower)) ||
                    (data.plaintiff && data.plaintiff.toLowerCase().includes(searchLower)) ||
                    (data.defendant && data.defendant.toLowerCase().includes(searchLower)) ||
                    (data.summary && data.summary.toLowerCase().includes(searchLower));
                if (!matches) return;
            }

            found = true;
            const row = document.createElement('tr');

            // Calculate recency based on createdAt (Firestore Timestamp)
            const createdDate = data.createdAt ? data.createdAt.toDate() : new Date();
            const isRecent = (Date.now() - createdDate) < (30 * 24 * 60 * 60 * 1000);

            row.innerHTML = `
                <td><strong>${data.caseFileNo || 'N/A'}</strong> ${isRecent ? '<span class="badge badge-warning" style="font-size: 0.6rem;">Recent</span>' : ''}</td>
                <td>${data.plaintiff || 'N/A'} vs ${data.defendant || 'N/A'}</td>
                <td>${data.bench || 'N/A'}</td>
                <td><span class="badge badge-success">Resolved</span></td>
                <td class="${isRecent ? 'locked-data' : ''}">${data.whoWon || '-'}</td>
                <td class="${isRecent ? 'locked-data' : ''}">${data.dateResolved || '-'}</td>
                <td class="${isRecent ? 'locked-data' : ''}" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${data.decisionCompared || '<span class="badge badge-premium"><i class="fas fa-lock"></i> Premium</span>'}
                </td>
            `;
            tableBody.appendChild(row);
        });

        if (!found) {
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-grey);">No matching records found.</td></tr>';
        }

        // Re-apply unblur if logged in
        if (currentUser) unlockPremium();

    } catch (error) {
        console.error('Error fetching cases:', error);
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: red;">Error connection to database.</td></tr>';
    }
}

// Global Search Handler
window.handleSearch = function () {
    const input = document.getElementById('searchInput');
    const keyword = input.value.trim();
    const submitBtn = document.querySelector('button[onclick="handleSearch()"]');

    submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
    fetchCases(keyword).finally(() => {
        submitBtn.innerHTML = 'Search Records';
    });
};

// Initial Fetch
fetchCases();

window.handleSubscribe = function (plan) {
    if (!currentUser) {
        alert('Please login first to subscribe to the ' + plan + ' plan.');
        openModal();
        return;
    }
    alert('Redirecting to secure payment for the ' + plan + ' plan...');
};

window.handleContact = function () {
    alert('Opening support channel...');
    if (typeof window.toggleChat === 'function') window.toggleChat();
};

// Smooth Scrolling for Nav Links
document.querySelectorAll('.nav-link').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetSection = document.querySelector(targetId);
        if (targetSection) {
            window.scrollTo({ top: targetSection.offsetTop, behavior: 'smooth' });
            document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            this.classList.add('active');
        }
    });
});

window.toggleMobileMenu = function () {
    document.querySelector('.nav-links').classList.toggle('active');
}

// Update active nav link on scroll
window.addEventListener('scroll', () => {
    const sections = document.querySelectorAll('section, header');
    const navLinks = document.querySelectorAll('.nav-link');
    let current = '';
    sections.forEach(section => {
        if (pageYOffset >= section.offsetTop - 100) {
            current = section.getAttribute('id');
        }
    });
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href').includes(current)) link.classList.add('active');
    });
});
