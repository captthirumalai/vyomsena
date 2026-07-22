/* ==========================================================================
   VYOMSENA AVIATION MANAGEMENT SYSTEM (VAMS) - CORE APPLICATION CONTROLLER
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // --- Firebase Initialization Check ---
    if (typeof firebase === 'undefined') {
        console.error("Firebase SDK was not loaded. Check internet connection or CDN URLs.");
        alert("Failed to connect to Firebase. Please check your internet connection.");
        return;
    }

    // Initialize Firebase using the config from firebase-config.js
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    // --- Active Database Listeners & Subscriptions ---
    let activePilotsListener = null;
    let activeAircraftListener = null;
    const pilotDocumentListeners = {}; // pilotUid -> unsubscribeFunction

    // --- Local Memory Cache for State Management ---
    let currentSession = null;
    let activeTab = 'ops-overview';
    let linkedPilots = [];
    let pilotDocumentsMap = {}; // pilotUid -> Array of UserDocument
    let aircraftFleet = [];

    // --- UI Element Selectors ---
    
    // Views
    const authView = document.getElementById('auth-view');
    const dashboardView = document.getElementById('dashboard-view');
    
    // Auth Cards
    const loginCard = document.getElementById('login-card');
    const registerCard = document.getElementById('register-card');
    const recoverCard = document.getElementById('recover-card');

    // Forms
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const recoverForm = document.getElementById('recover-form');

    // Navigation links
    const goRegister = document.getElementById('go-register');
    const goLogin = document.getElementById('go-login');
    const goRecover = document.getElementById('go-recover');
    const goLoginFromRecover = document.getElementById('go-login-from-recover');

    // Theme Toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    const toggleIconDark = themeToggleBtn.querySelector('.toggle-icon-dark');
    const toggleIconLight = themeToggleBtn.querySelector('.toggle-icon-light');

    // Sidebar & View Tabs
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const btnLogout = document.getElementById('btn-logout');

    // Modals
    const addAircraftModal = document.getElementById('add-aircraft-modal');
    const addCrewModal = document.getElementById('add-crew-modal');
    const btnOpenAircraftModal = document.getElementById('btn-add-aircraft-modal');
    const btnOpenCrewModal = document.getElementById('btn-add-crew-modal');
    const btnCloseAircraftModal = document.getElementById('btn-ac-modal-close');
    const btnCloseCrewModal = document.getElementById('btn-crew-modal-close');
    const formAddAircraft = document.getElementById('add-aircraft-form');
    const formAddCrew = document.getElementById('add-crew-form');

    // --- Date Helper ---
    function getFutureDate(daysOffset) {
        const d = new Date();
        d.setDate(d.getDate() + daysOffset);
        return d.toISOString().split('T')[0];
    }

    // --- Password strength calculator ---
    const regPasswordInput = document.getElementById('reg-password');
    const pwdIndicator = document.getElementById('pwd-strength-indicator');
    const pwdLabel = document.getElementById('pwd-strength-label');

    if (regPasswordInput) {
        regPasswordInput.addEventListener('input', () => {
            const val = regPasswordInput.value;
            let score = 0;
            if (val.length >= 8) score++;
            if (/[A-Z]/.test(val)) score++;
            if (/[0-9]/.test(val)) score++;
            if (/[^A-Za-z0-9]/.test(val)) score++;

            let color = '#ff1744';
            let label = 'Weak';
            let pct = '25%';

            if (score === 2) {
                color = '#ffb300';
                label = 'Medium';
                pct = '50%';
            } else if (score === 3) {
                color = '#00f0ff';
                label = 'Strong';
                pct = '75%';
            } else if (score === 4) {
                color = '#00e676';
                label = 'Excellent';
                pct = '100%';
            }

            pwdIndicator.style.width = pct;
            pwdIndicator.style.backgroundColor = color;
            pwdLabel.textContent = `Password Strength: ${label}`;
            pwdLabel.style.color = color;
        });
    }

    // --- Eye password toggle ---
    const passwordToggles = document.querySelectorAll('.password-toggle');
    passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            const input = toggle.closest('.input-wrapper').querySelector('input');
            const eyeOpen = toggle.querySelector('.eye-open');
            const eyeClosed = toggle.querySelector('.eye-closed');
            
            if (input.type === 'password') {
                input.type = 'text';
                eyeOpen?.classList.add('hidden');
                eyeClosed?.classList.remove('hidden');
            } else {
                input.type = 'password';
                eyeOpen?.classList.remove('hidden');
                eyeClosed?.classList.add('hidden');
            }
        });
    });

    // --- Auth SPA Card Routers ---
    goRegister.addEventListener('click', (e) => {
        e.preventDefault();
        loginCard.classList.remove('active');
        registerCard.classList.add('active');
    });

    goLogin.addEventListener('click', (e) => {
        e.preventDefault();
        registerCard.classList.remove('active');
        loginCard.classList.add('active');
    });

    goRecover.addEventListener('click', (e) => {
        e.preventDefault();
        loginCard.classList.remove('active');
        recoverCard.classList.add('active');
    });

    goLoginFromRecover.addEventListener('click', (e) => {
        e.preventDefault();
        recoverCard.classList.remove('active');
        loginCard.classList.add('active');
    });

    // --- Firebase Auth & State Listeners ---

    // Persistent Session Auth Listener
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log("Authenticated User detected Uid:", user.uid);
            try {
                // Fetch User Profile from /users/{uid}
                const profileDoc = await db.collection("users").document(user.uid).get();
                
                if (profileDoc.exists) {
                    const profileData = profileDoc.data();
                    currentSession = { uid: user.uid, ...profileData };
                    initializeDashboard(currentSession);
                } else {
                    // Initialize document if user doesn't have a profile yet (fallback)
                    const tempProfile = {
                        uid: user.uid,
                        name: user.displayName || user.email.split('@')[0],
                        email: user.email,
                        role: "OPERATIONS",
                        linkedOperator: null,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    await db.collection("users").document(user.uid).set(tempProfile);
                    currentSession = tempProfile;
                    initializeDashboard(currentSession);
                }
            } catch (err) {
                console.error("Error loading user profile:", err);
                alert("Failed to load user profile. Check Firestore permission rules.");
                auth.signOut();
            }
        } else {
            console.log("No authenticated session. Displaying login panel.");
            currentSession = null;
            cleanupDashboardListeners();
            dashboardView.classList.remove('active');
            authView.classList.add('active');
        }
    });

    // Login Submission Handler
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const pass = document.getElementById('login-password').value;
        const btnSubmit = document.getElementById('btn-login-submit');
        const errBanner = document.getElementById('login-error');
        
        btnSubmit.querySelector('.btn-text').classList.add('hidden');
        btnSubmit.querySelector('.btn-spinner').classList.remove('hidden');
        errBanner.classList.add('hidden');

        // Authenticate with Firebase Auth
        auth.signInWithEmailAndPassword(email, pass)
            .then((userCredential) => {
                btnSubmit.querySelector('.btn-text').classList.remove('hidden');
                btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
                loginForm.reset();
            })
            .catch((error) => {
                console.error("Sign-in failure:", error);
                btnSubmit.querySelector('.btn-text').classList.remove('hidden');
                btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
                
                loginCard.classList.add('shake');
                errBanner.querySelector('.error-msg').textContent = error.message;
                errBanner.classList.remove('hidden');
                setTimeout(() => loginCard.classList.remove('shake'), 400);
            });
    });

    // Registration Submission Handler
    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-org-name').value.trim();
        const type = document.getElementById('reg-org-type').value;
        const email = document.getElementById('reg-email').value.trim();
        const pass = document.getElementById('reg-password').value;
        const btnSubmit = document.getElementById('btn-register-submit');

        btnSubmit.querySelector('.btn-text').classList.add('hidden');
        btnSubmit.querySelector('.btn-spinner').classList.remove('hidden');

        // Create Firebase Auth user
        auth.createUserWithEmailAndPassword(email, pass)
            .then(async (userCredential) => {
                const uid = userCredential.user.uid;
                
                // Write profile to /users/{uid} matching Android structure
                const userProfile = {
                    uid: uid,
                    name: name,
                    email: email,
                    role: "OPERATIONS", // Web portal is for Operations management
                    linkedOperator: null, // Operators do not have a linked operator
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                await db.collection("users").document(uid).set(userProfile);
                
                btnSubmit.querySelector('.btn-text').classList.remove('hidden');
                btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
                
                alert(`VAMS Organization ${name} deployed successfully!`);
                registerForm.reset();
            })
            .catch((error) => {
                console.error("Registration failed:", error);
                btnSubmit.querySelector('.btn-text').classList.remove('hidden');
                btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
                alert("Registration Error: " + error.message);
            });
    });

    // Password Recovery Handler
    recoverForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('recover-email').value.trim();
        const btnSubmit = document.getElementById('btn-recover-submit');
        const successBanner = document.getElementById('recover-success');

        btnSubmit.querySelector('.btn-text').classList.add('hidden');
        btnSubmit.querySelector('.btn-spinner').classList.remove('hidden');

        // Trigger Firebase password reset email
        auth.sendPasswordResetEmail(email)
            .then(() => {
                btnSubmit.querySelector('.btn-text').classList.remove('hidden');
                btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
                successBanner.classList.remove('hidden');
                recoverForm.reset();
            })
            .catch((error) => {
                console.error("Recovery failed:", error);
                btnSubmit.querySelector('.btn-text').classList.remove('hidden');
                btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
                alert("Reset Request Error: " + error.message);
            });
    });

    // --- Dashboard Initializer ---
    function initializeDashboard(userProfile) {
        authView.classList.remove('active');
        dashboardView.classList.add('active');

        // Set Labels
        document.getElementById('display-org-name').textContent = userProfile.name;
        document.getElementById('display-org-type').textContent = `${userProfile.role} Account Workspace`;
        document.querySelector('.avatar-letter').textContent = userProfile.name.charAt(0).toUpperCase();

        // Start Live Clock
        startLiveClock();

        // Attach Real-time Firestore Listeners
        setupDashboardListeners(userProfile.uid);

        logActivityStream(`Connected to Firebase project: ${firebaseConfig.projectId}.`);
    }

    // Live Time Clock (UTC)
    function startLiveClock() {
        const clockEl = document.getElementById('live-clock');
        function updateClock() {
            const now = new Date();
            const utcString = now.toUTCString().replace('GMT', 'UTC');
            clockEl.textContent = utcString;
        }
        updateClock();
        setInterval(updateClock, 1000);
    }

    // Setup Real-time Firestore Listeners
    function setupDashboardListeners(operatorUid) {
        // Cleanup first just in case
        cleanupDashboardListeners();

        // 1. Listen to Aircraft Fleet
        activeAircraftListener = db.collection("aircraft")
            .onSnapshot((snapshot) => {
                aircraftFleet = [];
                snapshot.forEach(doc => {
                    aircraftFleet.push({ reg: doc.id, ...doc.data() });
                });
                renderFleetTable();
                refreshTelemetryStats();
            }, (error) => {
                console.error("Aircraft listener error:", error);
            });

        // 2. Listen to Linked Pilots (users where linkedOperator == operatorUid)
        activePilotsListener = db.collection("users")
            .where("linkedOperator", "==", operatorUid)
            .onSnapshot((snapshot) => {
                linkedPilots = [];
                snapshot.forEach(doc => {
                    linkedPilots.push({ uid: doc.id, ...doc.data() });
                });
                
                // Sync user document listeners for each active pilot
                syncPilotDocumentSubscriptions(linkedPilots);
                
                renderCrewTable();
                refreshTelemetryStats();
            }, (error) => {
                console.error("Pilots listener error:", error);
            });
    }

    // Sync individual document listeners per pilot to maintain real-time license updates
    function syncPilotDocumentSubscriptions(pilotsList) {
        // Remove document listeners for any pilots who were unlinked
        Object.keys(pilotDocumentListeners).forEach(uid => {
            if (!pilotsList.find(p => p.uid === uid)) {
                pilotDocumentListeners[uid](); // Unsubscribe
                delete pilotDocumentListeners[uid];
                delete pilotDocumentsMap[uid];
            }
        });

        // Attach listeners for new pilots
        pilotsList.forEach(pilot => {
            const pilotUid = pilot.uid;
            if (!pilotDocumentListeners[pilotUid]) {
                pilotDocumentListeners[pilotUid] = db.collection("user_documents")
                    .where("userId", "==", pilotUid)
                    .onSnapshot((snapshot) => {
                        const docs = [];
                        snapshot.forEach(doc => {
                            docs.push({ firestoreId: doc.id, ...doc.data() });
                        });
                        pilotDocumentsMap[pilotUid] = docs;
                        
                        // Update tables & metrics since license validities changed
                        renderCrewTable();
                        refreshTelemetryStats();
                    }, (error) => {
                        console.error(`Document listener error for pilot ${pilotUid}:`, error);
                    });
            }
        });
    }

    // Cleanup all Firestore subscriptions
    function cleanupDashboardListeners() {
        if (activeAircraftListener) {
            activeAircraftListener();
            activeAircraftListener = null;
        }
        if (activePilotsListener) {
            activePilotsListener();
            activePilotsListener = null;
        }
        Object.keys(pilotDocumentListeners).forEach(uid => {
            pilotDocumentListeners[uid](); // Unsubscribe
            delete pilotDocumentListeners[uid];
        });
        pilotDocumentsMap = {};
        linkedPilots = [];
        aircraftFleet = [];
    }

    // --- Telemetry Calculations (Metrics Dashboard) ---
    function refreshTelemetryStats() {
        // 1. Fleet Stats
        const totalFleet = aircraftFleet.length;
        const readyFleet = aircraftFleet.filter(a => a.status === 'Operational').length;
        const maintFleet = aircraftFleet.filter(a => a.status === 'Maintenance').length;

        document.getElementById('count-fleet-total').textContent = totalFleet;
        document.getElementById('count-fleet-ready').textContent = readyFleet;
        document.getElementById('count-fleet-maint').textContent = maintFleet;

        // 2. Crew Stats
        const totalCrew = linkedPilots.length;
        let expiringCrew = 0;
        let expiredCrew = 0;

        const today = new Date();

        // Audit expired & expiring licenses from Firestore Documents
        Object.keys(pilotDocumentsMap).forEach(uid => {
            const docs = pilotDocumentsMap[uid];
            let pilotExpired = false;
            let pilotExpiring = false;

            docs.forEach(doc => {
                if (doc.expiryDate) {
                    // ExpiryDate can be a Timestamp or Date
                    const expiry = doc.expiryDate.toDate ? doc.expiryDate.toDate() : new Date(doc.expiryDate);
                    const diffTime = expiry - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays < 0) {
                        pilotExpired = true;
                    } else if (diffDays <= 30) {
                        pilotExpiring = true;
                    }
                }
            });

            if (pilotExpired) expiredCrew++;
            else if (pilotExpiring) expiringCrew++;
        });

        document.getElementById('count-crew-total').textContent = totalCrew;
        document.getElementById('count-crew-expiring').textContent = expiringCrew;

        // 3. Compliance Rating Score (Base 100%)
        let score = 100;
        score -= (maintFleet * 2.5);
        score -= (expiredCrew * 10);
        score -= (expiringCrew * 3);
        score = Math.max(score, 45); // Floor at 45%

        const complianceEl = document.getElementById('compliance-rating');
        const fillEl = document.querySelector('.progress-fill');
        
        if (complianceEl) complianceEl.textContent = `${score.toFixed(1)}%`;
        if (fillEl) fillEl.style.width = `${score}%`;

        // Style the compliance rating text dynamically
        if (complianceEl) {
            if (score >= 90) {
                complianceEl.className = 'metric-value text-success';
            } else if (score >= 75) {
                complianceEl.className = 'metric-value text-warning';
            } else {
                complianceEl.className = 'metric-value text-danger';
            }
        }
    }

    // Stream logs locally
    function logActivityStream(text) {
        const stream = document.getElementById('activity-stream');
        if (!stream) return;

        const li = document.createElement('li');
        li.className = 'activity-item';
        li.innerHTML = `
            <span class="activity-time">Just Now</span>
            <span class="activity-text">${text}</span>
        `;
        stream.prepend(li);

        if (stream.children.length > 6) {
            stream.removeChild(stream.lastChild);
        }
    }

    // --- Tab Navigation Handlers ---
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            
            navItems.forEach(i => i.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            item.classList.add('active');
            
            const pane = document.getElementById(targetTab);
            if (pane) pane.classList.add('active');
            
            if (targetTab === 'ai-assistant-tab') {
                syncCopilotChats();
            }
        });
    });

    // Exit Console (Sign Out)
    btnLogout.addEventListener('click', () => {
        if (confirm('Lock and sign out of the VAMS session?')) {
            auth.signOut().then(() => {
                loginForm.reset();
            }).catch(err => {
                console.error("Signout error:", err);
            });
        }
    });

    // Theme Switcher
    themeToggleBtn.addEventListener('click', () => {
        const body = document.body;
        if (body.classList.contains('light-theme')) {
            body.classList.remove('light-theme');
            body.classList.add('dark-theme');
            toggleIconDark.classList.add('hidden');
            toggleIconLight.classList.remove('hidden');
        } else {
            body.classList.remove('dark-theme');
            body.classList.add('light-theme');
            toggleIconDark.classList.remove('hidden');
            toggleIconLight.classList.add('hidden');
        }
    });

    // --- Fleet Operations (Aircraft Collection Actions) ---
    function renderFleetTable() {
        const tableBody = document.getElementById('fleet-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = '';
        aircraftFleet.forEach((ac) => {
            let badgeClass = 'text-success';
            if (ac.status === 'Maintenance') badgeClass = 'text-warning';
            if (ac.status === 'Grounded') badgeClass = 'text-danger';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${ac.reg}</strong></td>
                <td>${ac.type}</td>
                <td><span class="sub-stat ${badgeClass}"><span class="bullet ${ac.status === 'Operational' ? 'success' : ac.status === 'Maintenance' ? 'warning' : 'danger'}"></span>${ac.status}</span></td>
                <td>${ac.nextInsp} hrs</td>
                <td>${ac.lastMaint || 'N/A'}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-secondary toggle-ac-status" data-reg="${ac.reg}">${ac.status === 'Operational' ? 'Hold CAMO' : 'Release'}</button>
                        <button class="btn btn-sm btn-secondary delete-ac text-danger" data-reg="${ac.reg}">Delete</button>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        // Event listener hooks
        document.querySelectorAll('.toggle-ac-status').forEach(btn => {
            btn.addEventListener('click', () => {
                const reg = btn.getAttribute('data-reg');
                toggleAircraftStatusInFirestore(reg);
            });
        });

        document.querySelectorAll('.delete-ac').forEach(btn => {
            btn.addEventListener('click', () => {
                const reg = btn.getAttribute('data-reg');
                deleteAircraftFromFirestore(reg);
            });
        });
    }

    async function toggleAircraftStatusInFirestore(reg) {
        const ac = aircraftFleet.find(a => a.reg === reg);
        if (ac) {
            const nextStatus = ac.status === 'Operational' ? 'Maintenance' : 'Operational';
            const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
            try {
                await db.collection("aircraft").document(reg).update({
                    status: nextStatus,
                    lastMaint: todayStr
                });
                logActivityStream(`Aircraft ${reg} updated to ${nextStatus}.`);
            } catch (err) {
                console.error("Failed to update aircraft status:", err);
            }
        }
    }

    async function deleteAircraftFromFirestore(reg) {
        if (confirm(`Remove aircraft ${reg} from organizational records?`)) {
            try {
                await db.collection("aircraft").document(reg).delete();
                logActivityStream(`Aircraft ${reg} deleted from fleet.`);
            } catch (err) {
                console.error("Failed to delete aircraft:", err);
            }
        }
    }

    // Modal Operations: Aircraft
    btnOpenAircraftModal.addEventListener('click', () => addAircraftModal.classList.add('active'));
    btnCloseAircraftModal.addEventListener('click', () => addAircraftModal.classList.remove('active'));
    
    formAddAircraft.addEventListener('submit', async (e) => {
        e.preventDefault();
        const reg = document.getElementById('ac-reg').value.trim().toUpperCase();
        const type = document.getElementById('ac-type').value.trim();
        const status = document.getElementById('ac-status').value;
        const nextInsp = parseInt(document.getElementById('ac-next-insp').value);
        
        try {
            const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
            
            await db.collection("aircraft").document(reg).set({
                reg: reg,
                type: type,
                status: status,
                nextInsp: nextInsp,
                lastMaint: todayStr
            });

            addAircraftModal.classList.remove('active');
            formAddAircraft.reset();
            logActivityStream(`Registered new fleet aircraft: ${reg}.`);
        } catch (err) {
            console.error("Failed to add aircraft:", err);
            alert("Error writing to Firestore: " + err.message);
        }
    });

    // --- Crew Operations (Users & User_Documents Collections) ---
    function renderCrewTable() {
        const tableBody = document.getElementById('crew-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = '';
        
        linkedPilots.forEach((pilot) => {
            const docs = pilotDocumentsMap[pilot.uid] || [];
            
            // Extract core licensing files
            const medicalDoc = docs.find(d => d.documentName && d.documentName.toLowerCase().includes('medical'));
            const cplDoc = docs.find(d => d.documentName && (d.documentName.toLowerCase().includes('cpl') || d.documentName.toLowerCase().includes('altp') || d.documentName.toLowerCase().includes('license')));

            const licenseNum = cplDoc ? cplDoc.licenseOrCertificateNumber : 'No CPL/ALTP Logged';
            
            let medicalVal = 'N/A';
            let status = 'No Licenses';
            let badgeClass = 'text-muted';
            let dot = 'danger';

            if (medicalDoc && medicalDoc.expiryDate) {
                const expiry = medicalDoc.expiryDate.toDate ? medicalDoc.expiryDate.toDate() : new Date(medicalDoc.expiryDate);
                medicalVal = expiry.toISOString().split('T')[0];
                
                const today = new Date();
                const diffTime = expiry - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays < 0) {
                    status = 'Expired';
                    badgeClass = 'text-danger';
                    dot = 'danger';
                } else if (diffDays <= 30) {
                    status = 'Expiring Soon';
                    badgeClass = 'text-warning';
                    dot = 'warning';
                } else {
                    status = 'Valid';
                    badgeClass = 'text-success';
                    dot = 'success';
                }
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${pilot.name}</strong><br><small style="color: var(--text-muted);">${pilot.email}</small></td>
                <td>Pilot (PIC)</td>
                <td>${licenseNum}</td>
                <td>${medicalVal}</td>
                <td><span class="sub-stat ${badgeClass}"><span class="bullet ${dot}"></span>${status}</span></td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-secondary delink-crew" data-uid="${pilot.uid}">Delink</button>
                        <button class="btn btn-sm btn-secondary delete-crew-all text-danger" data-uid="${pilot.uid}">Deregister</button>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        // Delink Pilot (Set linkedOperator to null)
        document.querySelectorAll('.delink-crew').forEach(btn => {
            btn.addEventListener('click', () => {
                const uid = btn.getAttribute('data-uid');
                delinkPilotFromOperator(uid);
            });
        });

        // Deregister Pilot completely
        document.querySelectorAll('.delete-crew-all').forEach(btn => {
            btn.addEventListener('click', () => {
                const uid = btn.getAttribute('data-uid');
                deregisterPilotCompletely(uid);
            });
        });
    }

    async function delinkPilotFromOperator(pilotUid) {
        if (confirm("Delink this pilot from your organization? They can link with another manager later.")) {
            try {
                await db.collection("users").document(pilotUid).update({
                    linkedOperator: null
                });
                logActivityStream(`Delinked pilot profile: ${pilotUid}.`);
            } catch (err) {
                console.error("Delinking failure:", err);
            }
        }
    }

    async function deregisterPilotCompletely(pilotUid) {
        if (confirm("Completely remove this pilot and all their license records from the database?")) {
            try {
                // Delete all license documents for this pilot
                const docsSnapshot = await db.collection("user_documents").where("userId", "==", pilotUid).get();
                const batch = db.batch();
                docsSnapshot.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();

                // Delete pilot profile
                await db.collection("users").document(pilotUid).delete();
                logActivityStream(`Deregistered pilot and deleted license records.`);
            } catch (err) {
                console.error("Deregistration error:", err);
            }
        }
    }

    // Modal Control: Crew (Direct Profile creation for testing/offline sync)
    btnOpenCrewModal.addEventListener('click', () => addCrewModal.classList.add('active'));
    btnCloseCrewModal.addEventListener('click', () => addCrewModal.classList.remove('active'));

    formAddCrew.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('crew-name').value.trim();
        const licenseNum = document.getElementById('crew-license').value.trim().toUpperCase();
        const medicalExpiryStr = document.getElementById('crew-medical').value;

        if (!currentSession) return;

        try {
            // Generate a random ID for this Pilot's user document
            const pilotUid = db.collection("users").document().id;
            
            // Create user profile in /users/{pilotUid}
            const pilotProfile = {
                uid: pilotUid,
                name: name,
                email: `${name.toLowerCase().replace(/ /g, '_')}@airvyom.com`,
                role: "PILOT",
                linkedOperator: currentSession.uid, // Instantly link to this operator
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await db.collection("users").document(pilotUid).set(pilotProfile);

            // Create Class 1 Medical document in /user_documents
            const medicalDocId = db.collection("user_documents").document().id;
            const medicalDoc = {
                firestoreId: medicalDocId,
                userId: pilotUid,
                userName: name,
                documentName: "Class 1 Medical",
                documentCategory: "MEDICAL",
                licenseOrCertificateNumber: "MED-" + licenseNum,
                issueDate: firebase.firestore.Timestamp.fromDate(new Date()),
                expiryDate: firebase.firestore.Timestamp.fromDate(new Date(medicalExpiryStr)),
                reminderLeadTimeDays: 30,
                operatorId: currentSession.uid,
                readers: [pilotUid, currentSession.uid]
            };

            await db.collection("user_documents").document(medicalDocId).set(medicalDoc);

            // Create License document (CPL/ALTP) in /user_documents
            const licenseDocId = db.collection("user_documents").document().id;
            const licenseDoc = {
                firestoreId: licenseDocId,
                userId: pilotUid,
                userName: name,
                documentName: "Commercial Pilot License (CPL)",
                documentCategory: "LICENCE",
                licenseOrCertificateNumber: licenseNum,
                issueDate: firebase.firestore.Timestamp.fromDate(new Date()),
                expiryDate: firebase.firestore.Timestamp.fromDate(new Date(getFutureDate(365))), // default 1 year
                reminderLeadTimeDays: 30,
                operatorId: currentSession.uid,
                readers: [pilotUid, currentSession.uid]
            };

            await db.collection("user_documents").document(licenseDocId).set(licenseDoc);

            addCrewModal.classList.remove('active');
            formAddCrew.reset();

            logActivityStream(`Created pilot profile and licenses for: ${name}.`);
        } catch (err) {
            console.error("Direct pilot addition failure:", err);
            alert("Error writing to Firestore: " + err.message);
        }
    });

    // --- Quick Action Hub Actions ---
    
    // Simulate DGCA Audit (real-time data audit)
    document.getElementById('btn-trigger-audit').addEventListener('click', () => {
        let report = `[DGCA AUDIT SIMULATION - LIVE DB]\n`;
        
        let expiredCount = 0;
        let expiringCount = 0;
        const today = new Date();

        Object.keys(pilotDocumentsMap).forEach(uid => {
            const docs = pilotDocumentsMap[uid];
            const pilot = linkedPilots.find(p => p.uid === uid);
            const pilotName = pilot ? pilot.name : "Unknown Pilot";

            docs.forEach(doc => {
                if (doc.expiryDate) {
                    const expiry = doc.expiryDate.toDate ? doc.expiryDate.toDate() : new Date(doc.expiryDate);
                    const diffTime = expiry - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays < 0) {
                        report += `🚨 EXPIRED LICENSE: ${pilotName} - ${doc.documentName} expired on ${expiry.toISOString().split('T')[0]}.\n`;
                        expiredCount++;
                    } else if (diffDays <= 30) {
                        report += `⚠️ EXPIRING SOON: ${pilotName} - ${doc.documentName} expires in ${diffDays} days.\n`;
                        expiringCount++;
                    }
                }
            });
        });

        const maintFleet = aircraftFleet.filter(a => a.status === 'Maintenance');
        if (maintFleet.length > 0) {
            report += `🔧 MAINTENANCE LOCKS: ${maintFleet.length} fleet aircraft are in CAMO checks.\n`;
        }

        if (expiredCount === 0 && expiringCount === 0 && maintFleet.length === 0) {
            report += `✅ LIVE AUDIT PASSED: 100% CAR compliance maintained across all linked pilots & aircraft.`;
        } else {
            report += `🚨 Action Required: Resolve the above items to maintain DGCA CAR compliance.`;
        }

        postCopilotMessage('System Alert', report, true);
        logActivityStream('DGCA Live CAR Audit completed.');
    });

    // Log Training Flight
    document.getElementById('btn-trigger-flight').addEventListener('click', async () => {
        const opsAircraft = aircraftFleet.filter(a => a.status === 'Operational');
        if (opsAircraft.length === 0) {
            alert('Cannot schedule flights. All fleet aircraft are grounded/under inspection.');
            return;
        }

        const targetAc = opsAircraft[Math.floor(Math.random() * opsAircraft.length)];
        const nextInspRemaining = Math.max(1, targetAc.nextInsp - 5);
        
        try {
            await db.collection("aircraft").document(targetAc.reg).update({
                nextInsp: nextInspRemaining
            });
            logActivityStream(`Logged 5 flight hours on ${targetAc.reg}.`);
            postCopilotMessage('System Message', `Flight block logged on ${targetAc.reg}. Maintenance inspection due in ${nextInspRemaining} flight hours.`, true);
        } catch (err) {
            console.error("Flight logging failed:", err);
        }
    });

    // Release Aircraft
    document.getElementById('btn-trigger-maint').addEventListener('click', async () => {
        const maintAircraft = aircraftFleet.filter(a => a.status === 'Maintenance');
        if (maintAircraft.length === 0) {
            alert('No fleet aircraft currently locked in maintenance.');
            return;
        }

        const targetAc = maintAircraft[0];
        const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
        
        try {
            await db.collection("aircraft").document(targetAc.reg).update({
                status: 'Operational',
                nextInsp: 100, // Reset
                lastMaint: todayStr
            });
            logActivityStream(`Released ${targetAc.reg} from CAMO maintenance.`);
            postCopilotMessage('System Message', `Aircraft ${targetAc.reg} released and signed off for operations after recurring checks.`, true);
        } catch (err) {
            console.error("Aircraft release failed:", err);
        }
    });

    // Ground Aircraft
    document.getElementById('btn-trigger-ground').addEventListener('click', async () => {
        const opsAircraft = aircraftFleet.filter(a => a.status === 'Operational');
        if (opsAircraft.length === 0) {
            alert('All aircraft already grounded or in maintenance.');
            return;
        }

        const targetAc = opsAircraft[0];
        
        try {
            await db.collection("aircraft").document(targetAc.reg).update({
                status: 'Maintenance'
            });
            logActivityStream(`Aircraft ${targetAc.reg} grounded for repairs.`);
            postCopilotMessage('System Message', `Alert: Aircraft ${targetAc.reg} has been flagged Grounded/Maintenance. DGCA airworthiness score updated.`, true);
        } catch (err) {
            console.error("Grounding failed:", err);
        }
    });

    // --- VAMS Co-Pilot AI Chat Logic ---
    const copilotChatMini = document.getElementById('copilot-chat');
    const copilotChatFull = document.getElementById('copilot-chat-full');
    const copilotInputMini = document.getElementById('copilot-input');
    const copilotInputFull = document.getElementById('copilot-input-full');
    const copilotFormMini = document.getElementById('copilot-form');
    const copilotFormFull = document.getElementById('copilot-form-full');

    // Submit handler
    copilotFormMini.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = copilotInputMini.value.trim();
        if (text) {
            handleCopilotUserQuery(text);
            copilotInputMini.value = '';
        }
    });

    copilotFormFull?.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = copilotInputFull.value.trim();
        if (text) {
            handleCopilotUserQuery(text);
            copilotInputFull.value = '';
        }
    });

    // Prompt Chips clicking
    document.querySelectorAll('.prompt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            handleCopilotUserQuery(prompt);
        });
    });

    function handleCopilotUserQuery(query) {
        postCopilotMessage('You', query, false);

        setTimeout(() => {
            const answer = generateCopilotResponse(query);
            postCopilotMessage('VAMS Co-Pilot', answer, true);
        }, 600);
    }

    function postCopilotMessage(sender, text, isSystem) {
        const createMsgEl = (snd, txt, sys) => {
            const div = document.createElement('div');
            div.className = `chat-message ${sys ? 'system-msg' : 'user-msg'}`;
            div.innerHTML = `
                <div class="msg-sender">${snd}</div>
                <div class="msg-bubble">${txt.replace(/\n/g, '<br>')}</div>
            `;
            return div;
        };

        if (copilotChatMini) {
            copilotChatMini.appendChild(createMsgEl(sender, text, isSystem));
            copilotChatMini.scrollTop = copilotChatMini.scrollHeight;
        }

        if (copilotChatFull) {
            copilotChatFull.appendChild(createMsgEl(sender, text, isSystem));
            copilotChatFull.scrollTop = copilotChatFull.scrollHeight;
        }
    }

    // Sync full tab with mini when opened
    function syncCopilotChats() {
        if (copilotChatMini && copilotChatFull) {
            copilotChatFull.innerHTML = copilotChatMini.innerHTML;
            copilotChatFull.scrollTop = copilotChatFull.scrollHeight;
        }
    }

    function generateCopilotResponse(query) {
        const q = query.toLowerCase();
        
        if (q.includes('medical') || q.includes('expiry') || q.includes('personnel')) {
            let res = `📋 **Crew Health Audit Report (Live Firestore):**\n`;
            let foundAny = false;
            const today = new Date();

            Object.keys(pilotDocumentsMap).forEach(uid => {
                const docs = pilotDocumentsMap[uid];
                const pilot = linkedPilots.find(p => p.uid === uid);
                const pilotName = pilot ? pilot.name : "Unknown Pilot";

                docs.forEach(doc => {
                    if (doc.documentName && doc.documentName.toLowerCase().includes('medical')) {
                        const expiry = doc.expiryDate.toDate ? doc.expiryDate.toDate() : new Date(doc.expiryDate);
                        const diffTime = expiry - today;
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                        if (diffDays < 0) {
                            res += `- 🛑 **${pilotName}**: Medical expired on ${expiry.toISOString().split('T')[0]}\n`;
                            foundAny = true;
                        } else if (diffDays <= 30) {
                            res += `- ⚠️ **${pilotName}**: Medical expires on ${expiry.toISOString().split('T')[0]} (in ${diffDays} days)\n`;
                            foundAny = true;
                        }
                    }
                });
            });

            if (!foundAny) {
                res += `✅ All linked pilot medical certifications are fully active.`;
            }
            return res;
        }

        if (q.includes('airworthiness') || q.includes('fleet') || q.includes('aircraft')) {
            const operational = aircraftFleet.filter(a => a.status === 'Operational');
            const maint = aircraftFleet.filter(a => a.status === 'Maintenance');
            
            let res = `✈️ **Fleet Airworthiness Status (Live Firestore):**\n`;
            res += `- Total Fleet size: ${aircraftFleet.length} registered aircraft\n`;
            res += `- Active/Operational: ${operational.length}\n`;
            res += `- Under CAMO inspection lock: ${maint.length}\n\n`;

            if (maint.length > 0) {
                res += `🔧 **Awaiting Sign-off:**\n`;
                maint.forEach(a => res += `- ${a.reg} (${a.type}): Next inspection in ${a.nextInsp} flight hours.\n`);
            } else {
                res += `✅ All planes are fully operational.`;
            }
            return res;
        }

        if (q.includes('compliance') || q.includes('score')) {
            const scoreEl = document.getElementById('compliance-rating');
            const score = scoreEl ? scoreEl.textContent : '100.0%';
            
            let res = `🛡️ **Compliance Audit Log (VAMS Score: ${score})**\n`;
            res += `This score is synced dynamically with your Cloud Firestore collections:\n`;
            res += `1. **Personnel:** Any expired pilot medical drops score by 10%.\n`;
            res += `2. **Fleet:** Grounded aircraft under inspection drops score by 2.5%.\n\n`;
            res += `*Connect new pilots on their mobile app using your operator ID to update.*`;
            return res;
        }

        return `Inquiry received. Checked Firestore: I found ${aircraftFleet.length} aircraft and ${linkedPilots.length} active pilots. Let me know if you would like me to audit credentials or check airworthiness.`;
    }

});
