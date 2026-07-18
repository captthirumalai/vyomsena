/* ==========================================================================
   VYOMSENA AVIATION MANAGEMENT SYSTEM (VAMS) - CORE APPLICATION CONTROLLER
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    
    // --- Mock Database Initializer ---
    const defaultUsers = [
        { email: 'admin@airvyom.com', password: 'password123', orgName: 'AirVyom Charters', orgType: 'NSOP' }
    ];

    const defaultAircraft = [
        { reg: 'VT-VAA', type: 'Cessna 172R', status: 'Operational', nextInsp: 45, lastMaint: '12-Jul-2026' },
        { reg: 'VT-VAB', type: 'Beechcraft King Air B200', status: 'Operational', nextInsp: 82, lastMaint: '10-Jul-2026' },
        { reg: 'VT-VAC', type: 'Piper PA-34 Seneca', status: 'Maintenance', nextInsp: 8, lastMaint: '01-Jul-2026' },
        { reg: 'VT-VAD', type: 'Cessna Caravan 208B', status: 'Operational', nextInsp: 91, lastMaint: '14-Jul-2026' }
    ];

    const defaultCrew = [
        { name: 'Capt. Rahul Sharma', rank: 'PIC (Captain)', license: 'ALTP-6542', medical: getFutureDate(90), status: 'Valid' },
        { name: 'Capt. Priya Verma', rank: 'Co-Pilot', license: 'CPL-8021', medical: getFutureDate(12), status: 'Expiring Soon' },
        { name: 'Amit Sengupta', rank: 'AME (Engineer)', license: 'AME-3049', medical: getFutureDate(240), status: 'Valid' },
        { name: 'Capt. Jessica Dsouza', rank: 'Flight Instructor', license: 'ALTP-7822', medical: getFutureDate(-5), status: 'Expired' }
    ];

    // Seed local storage if empty
    if (!localStorage.getItem('vams_users')) {
        localStorage.setItem('vams_users', JSON.stringify(defaultUsers));
    }
    if (!localStorage.getItem('vams_aircraft')) {
        localStorage.setItem('vams_aircraft', JSON.stringify(defaultAircraft));
    }
    if (!localStorage.getItem('vams_crew')) {
        localStorage.setItem('vams_crew', JSON.stringify(defaultCrew));
    }

    // --- State Variables ---
    let currentSession = null;
    let activeTab = 'ops-overview';

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

    // --- Authentication Handlers ---
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        const btnSubmit = document.getElementById('btn-login-submit');
        const errBanner = document.getElementById('login-error');
        
        btnSubmit.querySelector('.btn-text').classList.add('hidden');
        btnSubmit.querySelector('.btn-spinner').classList.remove('hidden');
        errBanner.classList.add('hidden');

        // Simulate network latency (1.2s)
        setTimeout(() => {
            const users = JSON.parse(localStorage.getItem('vams_users')) || [];
            const user = users.find(u => u.email === email && u.password === pass);

            btnSubmit.querySelector('.btn-text').classList.remove('hidden');
            btnSubmit.querySelector('.btn-spinner').classList.add('hidden');

            if (user) {
                currentSession = user;
                initializeDashboard(user);
            } else {
                // Shake effect on error
                loginCard.classList.add('shake');
                errBanner.classList.remove('hidden');
                setTimeout(() => loginCard.classList.remove('shake'), 400);
            }
        }, 1200);
    });

    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-org-name').value;
        const type = document.getElementById('reg-org-type').value;
        const email = document.getElementById('reg-email').value;
        const pass = document.getElementById('reg-password').value;
        const btnSubmit = document.getElementById('btn-register-submit');

        btnSubmit.querySelector('.btn-text').classList.add('hidden');
        btnSubmit.querySelector('.btn-spinner').classList.remove('hidden');

        setTimeout(() => {
            const users = JSON.parse(localStorage.getItem('vams_users')) || [];
            
            // Check duplicate
            if (users.find(u => u.email === email)) {
                alert('Administrator email is already registered.');
                btnSubmit.querySelector('.btn-text').classList.remove('hidden');
                btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
                return;
            }

            const newUser = { email, password: pass, orgName: name, orgType: type };
            users.push(newUser);
            localStorage.setItem('vams_users', JSON.stringify(users));

            btnSubmit.querySelector('.btn-text').classList.remove('hidden');
            btnSubmit.querySelector('.btn-spinner').classList.add('hidden');

            alert('VyomSena VAMS Organization Tenant deployed! Proceeding to Sign In.');
            registerCard.classList.remove('active');
            loginCard.classList.add('active');
            loginForm.reset();
        }, 1000);
    });

    recoverForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const btnSubmit = document.getElementById('btn-recover-submit');
        const successBanner = document.getElementById('recover-success');

        btnSubmit.querySelector('.btn-text').classList.add('hidden');
        btnSubmit.querySelector('.btn-spinner').classList.remove('hidden');

        setTimeout(() => {
            btnSubmit.querySelector('.btn-text').classList.remove('hidden');
            btnSubmit.querySelector('.btn-spinner').classList.add('hidden');
            successBanner.classList.remove('hidden');
        }, 1000);
    });

    // --- Dashboard Initializer ---
    function initializeDashboard(user) {
        authView.classList.remove('active');
        dashboardView.classList.add('active');

        // Set labels
        document.getElementById('display-org-name').textContent = user.orgName;
        document.getElementById('display-org-type').textContent = `${user.orgType} Platform Tenant`;
        document.querySelector('.avatar-letter').textContent = user.orgName.charAt(0).toUpperCase();

        // Update stats
        refreshTelemetryStats();
        
        // Start UTC Clock
        startLiveClock();

        // Load Tables
        renderFleetTable();
        renderCrewTable();

        logActivityStream('VAMS Operations center activated successfully.');
    }

    // --- Live Time Clock ---
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

    // --- Telemetry Calculation & Renders ---
    function refreshTelemetryStats() {
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        const crew = JSON.parse(localStorage.getItem('vams_crew')) || [];

        // Fleet stats
        const totalFleet = fleet.length;
        const readyFleet = fleet.filter(a => a.status === 'Operational').length;
        const maintFleet = fleet.filter(a => a.status === 'Maintenance').length;

        document.getElementById('count-fleet-total').textContent = totalFleet;
        document.getElementById('count-fleet-ready').textContent = readyFleet;
        document.getElementById('count-fleet-maint').textContent = maintFleet;

        // Crew stats
        const totalCrew = crew.length;
        let expiringCrew = 0;
        let expiredCrew = 0;

        const today = new Date();
        crew.forEach(c => {
            const expiry = new Date(c.medical);
            const diffTime = expiry - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays < 0) {
                expiredCrew++;
                c.status = 'Expired';
            } else if (diffDays <= 30) {
                expiringCrew++;
                c.status = 'Expiring Soon';
            } else {
                c.status = 'Valid';
            }
        });
        localStorage.setItem('vams_crew', JSON.stringify(crew));

        document.getElementById('count-crew-total').textContent = totalCrew;
        document.getElementById('count-crew-expiring').textContent = expiringCrew;

        // Compliance Rating Score
        // Base score 100%. Deduct 5% for maintenance aircraft, 8% for expired medicals, 3% for expiring medicals.
        let score = 100;
        score -= (maintFleet * 2.5);
        score -= (expiredCrew * 10);
        score -= (expiringCrew * 3);
        score = Math.max(score, 45); // Floor it at 45%

        const complianceEl = document.getElementById('compliance-rating');
        const fillEl = document.querySelector('.progress-fill');
        
        complianceEl.textContent = `${score.toFixed(1)}%`;
        if (fillEl) fillEl.style.width = `${score}%`;

        // Style the rating text
        if (score >= 90) {
            complianceEl.className = 'metric-value text-success';
        } else if (score >= 75) {
            complianceEl.className = 'metric-value text-warning';
        } else {
            complianceEl.className = 'metric-value text-danger';
        }
    }

    // --- Activity stream logs ---
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

        // Keep list to 6 items
        if (stream.children.length > 6) {
            stream.removeChild(stream.lastChild);
        }
    }

    // --- Tab Switching ---
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            
            navItems.forEach(i => i.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            item.classList.add('active');
            
            const pane = document.getElementById(targetTab);
            if (pane) pane.classList.add('active');
            
            // Sync Co-Pilot chat when entering assistant tab
            if (targetTab === 'ai-assistant-tab') {
                syncCopilotChats();
            }
        });
    });

    // Logout
    btnLogout.addEventListener('click', () => {
        if (confirm('Are you sure you want to lock and exit the VAMS console?')) {
            currentSession = null;
            dashboardView.classList.remove('active');
            authView.classList.add('active');
            loginForm.reset();
        }
    });

    // --- Theme Switcher ---
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

    // --- Fleet Tables Render ---
    function renderFleetTable() {
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        const tableBody = document.getElementById('fleet-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = '';
        fleet.forEach((ac, idx) => {
            let badgeClass = 'text-success';
            if (ac.status === 'Maintenance') badgeClass = 'text-warning';
            if (ac.status === 'Grounded') badgeClass = 'text-danger';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${ac.reg}</strong></td>
                <td>${ac.type}</td>
                <td><span class="sub-stat ${badgeClass}"><span class="bullet ${ac.status === 'Operational' ? 'success' : ac.status === 'Maintenance' ? 'warning' : 'danger'}"></span>${ac.status}</span></td>
                <td>${ac.nextInsp} hrs</td>
                <td>${ac.lastMaint}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-secondary toggle-ac-status" data-reg="${ac.reg}">${ac.status === 'Operational' ? 'Hold CAMO' : 'Release'}</button>
                        <button class="btn btn-sm btn-secondary delete-ac text-danger" data-idx="${idx}">Delete</button>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        // Attach event listeners to dynamic buttons
        document.querySelectorAll('.toggle-ac-status').forEach(btn => {
            btn.addEventListener('click', () => {
                const reg = btn.getAttribute('data-reg');
                toggleAircraftStatus(reg);
            });
        });

        document.querySelectorAll('.delete-ac').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-idx'));
                deleteAircraft(idx);
            });
        });
    }

    function toggleAircraftStatus(reg) {
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        const ac = fleet.find(a => a.reg === reg);
        if (ac) {
            ac.status = ac.status === 'Operational' ? 'Maintenance' : 'Operational';
            ac.lastMaint = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
            localStorage.setItem('vams_aircraft', JSON.stringify(fleet));
            renderFleetTable();
            refreshTelemetryStats();
            logActivityStream(`Aircraft ${reg} status set to ${ac.status}.`);
        }
    }

    function deleteAircraft(idx) {
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        const reg = fleet[idx].reg;
        if (confirm(`Remove aircraft ${reg} from organizational records?`)) {
            fleet.splice(idx, 1);
            localStorage.setItem('vams_aircraft', JSON.stringify(fleet));
            renderFleetTable();
            refreshTelemetryStats();
            logActivityStream(`Aircraft ${reg} removed from fleet register.`);
        }
    }

    // Modal Control: Aircraft
    btnOpenAircraftModal.addEventListener('click', () => addAircraftModal.classList.add('active'));
    btnCloseAircraftModal.addEventListener('click', () => addAircraftModal.classList.remove('active'));
    
    formAddAircraft.addEventListener('submit', (e) => {
        e.preventDefault();
        const reg = document.getElementById('ac-reg').value.toUpperCase();
        const type = document.getElementById('ac-type').value;
        const status = document.getElementById('ac-status').value;
        const nextInsp = parseInt(document.getElementById('ac-next-insp').value);
        
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        
        if (fleet.find(a => a.reg === reg)) {
            alert('Aircraft registration mark already registered.');
            return;
        }

        const newAc = {
            reg,
            type,
            status,
            nextInsp,
            lastMaint: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
        };

        fleet.push(newAc);
        localStorage.setItem('vams_aircraft', JSON.stringify(fleet));
        
        addAircraftModal.classList.remove('active');
        formAddAircraft.reset();
        
        renderFleetTable();
        refreshTelemetryStats();
        logActivityStream(`New aircraft ${reg} registered into system.`);
    });


    // --- Crew Tables Render ---
    function renderCrewTable() {
        const crew = JSON.parse(localStorage.getItem('vams_crew')) || [];
        const tableBody = document.getElementById('crew-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = '';
        crew.forEach((cr, idx) => {
            let badgeClass = 'text-success';
            let dot = 'success';
            if (cr.status === 'Expiring Soon') { badgeClass = 'text-warning'; dot = 'warning'; }
            if (cr.status === 'Expired') { badgeClass = 'text-danger'; dot = 'danger'; }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${cr.name}</strong></td>
                <td>${cr.rank}</td>
                <td>${cr.license}</td>
                <td>${cr.medical}</td>
                <td><span class="sub-stat ${badgeClass}"><span class="bullet ${dot}"></span>${cr.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-secondary delete-crew text-danger" data-idx="${idx}">Remove</button>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        document.querySelectorAll('.delete-crew').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-idx'));
                deleteCrew(idx);
            });
        });
    }

    function deleteCrew(idx) {
        const crew = JSON.parse(localStorage.getItem('vams_crew')) || [];
        const name = crew[idx].name;
        if (confirm(`Remove personnel ${name} from organizational records?`)) {
            crew.splice(idx, 1);
            localStorage.setItem('vams_crew', JSON.stringify(crew));
            renderCrewTable();
            refreshTelemetryStats();
            logActivityStream(`Personnel ${name} deregistered.`);
        }
    }

    // Modal Control: Crew
    btnOpenCrewModal.addEventListener('click', () => addCrewModal.classList.add('active'));
    btnCloseCrewModal.addEventListener('click', () => addCrewModal.classList.remove('active'));

    formAddCrew.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('crew-name').value;
        const rank = document.getElementById('crew-rank').value;
        const license = document.getElementById('crew-license').value.toUpperCase();
        const medical = document.getElementById('crew-medical').value;

        const crew = JSON.parse(localStorage.getItem('vams_crew')) || [];
        const newMember = { name, rank, license, medical, status: 'Valid' };

        crew.push(newMember);
        localStorage.setItem('vams_crew', JSON.stringify(crew));

        addCrewModal.classList.remove('active');
        formAddCrew.reset();

        renderCrewTable();
        refreshTelemetryStats();
        logActivityStream(`Aviation personnel ${name} added.`);
    });


    // --- Quick Action Hub Simulator Buttons ---
    
    // Simulate DGCA Audit
    document.getElementById('btn-trigger-audit').addEventListener('click', () => {
        const crew = JSON.parse(localStorage.getItem('vams_crew')) || [];
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        
        let report = `[DGCA AUDIT SIMULATION]\n`;
        const expired = crew.filter(c => c.status === 'Expired');
        const maint = fleet.filter(a => a.status === 'Maintenance');
        
        if (expired.length > 0) {
            report += `⚠️ COMPLIANCE VIOLATION: ${expired.length} crew members have expired medical ratings.\n`;
        }
        if (maint.length > 0) {
            report += `ℹ️ MAINTENANCE HOLD: ${maint.length} aircraft locked in CAMO inspections.\n`;
        }
        if (expired.length === 0 && maint.length === 0) {
            report += `✅ compliance check complete. 100% CAR compliance maintained. No findings.`;
        } else {
            report += `⚠️ Recommended: Clear expired personnel licenses immediately.`;
        }

        // Add to co-pilot chat automatically
        postCopilotMessage('System Alert', report, true);
        logActivityStream('DGCA CAR Audit simulation triggered.');
    });

    // Log Training Flight
    document.getElementById('btn-trigger-flight').addEventListener('click', () => {
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        const ops = fleet.filter(a => a.status === 'Operational');
        if (ops.length === 0) {
            alert('Cannot schedule flights. All fleet aircraft are grounded/under inspection.');
            return;
        }

        const ac = ops[Math.floor(Math.random() * ops.length)];
        ac.nextInsp = Math.max(1, ac.nextInsp - 5); // reduce next maintenance time
        localStorage.setItem('vams_aircraft', JSON.stringify(fleet));

        renderFleetTable();
        refreshTelemetryStats();
        logActivityStream(`Flight logged for ${ac.reg} (C172). 5 hours block logged.`);
        postCopilotMessage('System Message', `FlightVT logged successfully on ${ac.reg}. Next inspection is in ${ac.nextInsp} flight hours.`, true);
    });

    // Release Aircraft
    document.getElementById('btn-trigger-maint').addEventListener('click', () => {
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        const maint = fleet.filter(a => a.status === 'Maintenance');
        if (maint.length === 0) {
            alert('No fleet aircraft currently locked in maintenance.');
            return;
        }

        const ac = maint[0];
        ac.status = 'Operational';
        ac.nextInsp = 100; // Reset inspection hours
        ac.lastMaint = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
        localStorage.setItem('vams_aircraft', JSON.stringify(fleet));

        renderFleetTable();
        refreshTelemetryStats();
        logActivityStream(`Aircraft ${ac.reg} released from CAMO checks.`);
        postCopilotMessage('System Message', `Aircraft ${ac.reg} released and signed off for operations after recurring checks.`, true);
    });

    // Ground Aircraft
    document.getElementById('btn-trigger-ground').addEventListener('click', () => {
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        const ops = fleet.filter(a => a.status === 'Operational');
        if (ops.length === 0) {
            alert('All aircraft already grounded or in maintenance.');
            return;
        }

        const ac = ops[0];
        ac.status = 'Maintenance';
        localStorage.setItem('vams_aircraft', JSON.stringify(fleet));

        renderFleetTable();
        refreshTelemetryStats();
        logActivityStream(`Aircraft ${ac.reg} grounded for maintenance check.`);
        postCopilotMessage('System Message', `Alert: Aircraft ${ac.reg} has been flagged Grounded/Maintenance. DGCA airworthiness score updated.`, true);
    });


    // --- VAMS Co-Pilot AI Chat Logic ---
    const copilotChatMini = document.getElementById('copilot-chat');
    const copilotChatFull = document.getElementById('copilot-chat-full');
    const copilotInputMini = document.getElementById('copilot-input');
    const copilotInputFull = document.getElementById('copilot-input-full');
    const copilotFormMini = document.getElementById('copilot-form');
    const copilotFormFull = document.getElementById('copilot-form-full');

    // Handle submissions
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
        // Post user message
        postCopilotMessage('You', query, false);

        // Calculate Answer
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
        const fleet = JSON.parse(localStorage.getItem('vams_aircraft')) || [];
        const crew = JSON.parse(localStorage.getItem('vams_crew')) || [];

        if (q.includes('medical') || q.includes('expiry') || q.includes('personnel')) {
            const expiring = crew.filter(c => c.status === 'Expiring Soon');
            const expired = crew.filter(c => c.status === 'Expired');
            
            let res = `📋 **Crew Health Audit Report:**\n`;
            if (expired.length === 0 && expiring.length === 0) {
                return res + `✅ All registered personnel have fully active Class 1/2 medical certifications.`;
            }
            
            if (expired.length > 0) {
                res += `🛑 **Expired License Holders (Suspended):**\n`;
                expired.forEach(c => res += `- ${c.name} (${c.rank}): Expired on ${c.medical}\n`);
            }
            if (expiring.length > 0) {
                res += `⚠️ **Expiring in 30 Days:**\n`;
                expiring.forEach(c => res += `- ${c.name} (${c.rank}): Expires on ${c.medical}\n`);
            }
            return res;
        }

        if (q.includes('airworthiness') || q.includes('fleet') || q.includes('aircraft')) {
            const operational = fleet.filter(a => a.status === 'Operational');
            const maint = fleet.filter(a => a.status === 'Maintenance');
            
            let res = `✈️ **Fleet Airworthiness Status:**\n`;
            res += `- Total Fleet size: ${fleet.length} registered aircraft\n`;
            res += `- Active/Operational: ${operational.length}\n`;
            res += `- Under CAMO inspection lock: ${maint.length}\n\n`;

            if (maint.length > 0) {
                res += `🔧 **Awaiting Sign-off:**\n`;
                maint.forEach(a => res += `- ${a.reg} (${a.type}): ${a.nextInsp} inspection hours remaining.\n`);
            } else {
                res += `✅ All planes are fully operational.`;
            }
            return res;
        }

        if (q.includes('compliance') || q.includes('score')) {
            const scoreEl = document.getElementById('compliance-rating');
            const score = scoreEl ? scoreEl.textContent : '96.8%';
            
            let res = `🛡️ **Compliance Audit Log (VAMS Score: ${score})**\n`;
            res += `This score is automatically calculated using DGCA CAR regulatory compliance checklists:\n`;
            res += `1. **Personnel:** Any expired crew medical drops score by 10% (Immediate safety hold).\n`;
            res += `2. **Fleet:** Grounded aircraft under inspection drops score by 2.5%.\n\n`;
            res += `*VAMS monitors this feed dynamically to assure complete compliance status.*`;
            return res;
        }

        return `Inquiry received. Over VAMS DB: I found ${fleet.length} aircraft and ${crew.length} active pilots. Let me know if you would like me to audit credentials or check airworthiness.`;
    }

});
