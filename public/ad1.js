// admin.js - Complete version with Optimistic UI, Toasts, and "Copy URL" in logs

document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selectors ---
    const loginContainer = document.getElementById('login-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const loginForm = document.getElementById('login-form');
    const passwordInput = document.getElementById('password-input');
    const loginError = document.getElementById('login-error');
    const logoutBtn = document.getElementById('logout-btn');
    const cacheSizeEl = document.getElementById('cache-size');
    const logSizeEl = document.getElementById('log-size');
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const requestsList = document.getElementById('requests-list');
    const blockDomainForm = document.getElementById('block-domain-form');
    const domainInput = document.getElementById('domain-input');
    const blockedDomainsList = document.getElementById('blocked-domains-list');
    const redirectToggle = document.getElementById('redirect-toggle');
    let adminPassword = sessionStorage.getItem('admin_password');

    // --- Toast Notification System ---
    const showAdminToast = (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        // Style for fixed position, as it's not in the main toast container
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.zIndex = '9999';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    };

    // --- Core UI State Management ---
    const showLogin = () => {
        if (loginContainer) loginContainer.classList.remove('hidden');
        if (dashboardContainer) dashboardContainer.classList.add('hidden');
        if (passwordInput) passwordInput.value = '';
    };

    const showDashboard = () => {
        if (loginContainer) loginContainer.classList.add('hidden');
        if (dashboardContainer) dashboardContainer.classList.remove('hidden');
        fetchDashboardData();
    };

    // --- Data Fetching and Rendering ---
    const fetchDashboardData = async () => {
        if (!adminPassword) return showLogin();
        const headers = { 'Authorization': `Bearer ${adminPassword}` };
        try {
            // Fetch all data in parallel for performance
            const responses = await Promise.all([
                fetch('/api/admin/stats', { headers }),
                fetch('/api/admin/requests', { headers }),
                fetch('/api/admin/blocked-domains', { headers }),
                fetch('/api/admin/settings', { headers })
            ]);

            // Centralized error handling for all fetches
            const unauthorizedResponse = responses.find(res => res.status === 401);
            if (unauthorizedResponse) {
                sessionStorage.removeItem('admin_password');
                adminPassword = null;
                if(loginError) {
                    loginError.textContent = "Your session has expired. Please log in again.";
                    loginError.classList.remove('hidden');
                }
                return showLogin();
            }

            const failedResponse = responses.find(res => !res.ok);
            if (failedResponse) {
                const errorData = await failedResponse.json().catch(() => ({ error: 'An unknown server error occurred.' }));
                throw new Error(errorData.error);
            }

            const [stats, requests, domains, settings] = await Promise.all(responses.map(res => res.json()));

            // Populate stats and settings
            if (cacheSizeEl) cacheSizeEl.textContent = stats.cacheSize;
            if (logSizeEl) logSizeEl.textContent = requests.length;
            if (redirectToggle) redirectToggle.checked = settings.is_redirect_mode_enabled;

            // Populate request logs
            if (requestsList) {
                requestsList.innerHTML = '';
                if (requests.length === 0) {
                    requestsList.innerHTML = '<p>No recent requests to display.</p>';
                } else {
                    requests.forEach(req => {
                        const item = document.createElement('div');
                        item.className = 'request-item';
                        const timestamp = new Date(req.timestamp).toLocaleString();
                        item.innerHTML = `
                            <span class="timestamp">${timestamp}</span>
                            <span class="url" title="Hover to see full URL: ${req.url}">${req.url}</span>
                            <button class="request-copy-btn" data-url="${req.url}" title="Copy URL">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            </button>
                        `;
                        requestsList.appendChild(item);
                    });
                }
            }

            // Populate blocked domains
            if (blockedDomainsList) {
                blockedDomainsList.innerHTML = '';
                if (domains.length === 0) {
                    blockedDomainsList.innerHTML = '<p>No domains are currently blocked.</p>';
                } else {
                    domains.forEach(domain => addDomainToList(domain));
                }
            }

        } catch (error) {
            console.error("Failed to fetch dashboard data:", error);
            showAdminToast(`Failed to load dashboard data: ${error.message}`, 'error');
        }
    };

    const addDomainToList = (domain) => {
        if (!blockedDomainsList) return;
        const placeholder = blockedDomainsList.querySelector('p');
        if (placeholder) placeholder.remove();

        const item = document.createElement('div');
        item.className = 'request-item';
        item.dataset.domain = domain;
        item.innerHTML = `<span class="url">${domain}</span><button class="remove-btn" data-domain="${domain}" title="Unblock ${domain}">×</button>`;
        blockedDomainsList.appendChild(item);
    };

    // --- Event Listeners ---

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = passwordInput.value;
            try {
                const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
                const data = await response.json();
                if (data.success) {
                    adminPassword = password;
                    sessionStorage.setItem('admin_password', password);
                    if (loginError) loginError.classList.add('hidden');
                    showDashboard();
                } else {
                    if (loginError) {
                        loginError.textContent = data.error || 'Login failed.';
                        loginError.classList.remove('hidden');
                    }
                }
            } catch (error) {
                if (loginError) {
                    loginError.textContent = 'An error occurred during login.';
                    loginError.classList.remove('hidden');
                }
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            adminPassword = null;
            sessionStorage.removeItem('admin_password');
            showLogin();
        });
    }

    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            if (!adminPassword || !confirm("Are you sure? This action cannot be undone.")) return;
            clearCacheBtn.disabled = true;
            clearCacheBtn.textContent = 'Clearing...';
            try {
                await fetch('/api/admin/clear-cache', { method: 'POST', headers: { 'Authorization': `Bearer ${adminPassword}` } });
                fetchDashboardData(); // Refresh data
                showAdminToast('Cache cleared successfully.', 'success');
            } catch (error) {
                console.error("Failed to clear cache:", error);
                showAdminToast("Failed to clear cache.", 'error');
            } finally {
                clearCacheBtn.disabled = false;
                clearCacheBtn.textContent = 'Clear Cache';
            }
        });
    }

    if (redirectToggle) {
        redirectToggle.addEventListener('change', async () => {
            if (!adminPassword) return;
            const isEnabled = redirectToggle.checked;
            try {
                await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminPassword}` }, body: JSON.stringify({ is_redirect_mode_enabled: isEnabled }) });
                showAdminToast('Setting updated.', 'success');
            } catch (error) {
                console.error("Failed to update setting:", error);
                showAdminToast("Failed to update download mode setting.", 'error');
                redirectToggle.checked = !isEnabled; // Revert on failure
            }
        });
    }

    if (blockDomainForm) {
        blockDomainForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const domain = domainInput.value.trim();
            if (!adminPassword || !domain) return;

            addDomainToList(domain);
            const originalValue = domainInput.value;
            domainInput.value = '';

            try {
                const response = await fetch('/api/admin/blocked-domains', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminPassword}` }, body: JSON.stringify({ domain }) });
                if (!response.ok) throw new Error('Server rejected the request.');
                showAdminToast(`Domain "${domain}" blocked.`, 'success');
            } catch (error) {
                showAdminToast(`Failed to block domain "${domain}".`, 'error');
                const itemToRemove = blockedDomainsList.querySelector(`div[data-domain="${domain}"]`);
                if (itemToRemove) itemToRemove.remove();
                domainInput.value = originalValue;
                if (blockedDomainsList.children.length === 0) {
                    blockedDomainsList.innerHTML = '<p>No domains are currently blocked.</p>';
                }
            }
        });
    }

    if (blockedDomainsList) {
        blockedDomainsList.addEventListener('click', async (e) => {
            if (!e.target.classList.contains('remove-btn')) return;
            
            const domain = e.target.dataset.domain;
            if (!adminPassword || !confirm(`Are you sure you want to unblock "${domain}"?`)) return;

            const itemToRemove = e.target.closest('.request-item');
            itemToRemove.style.opacity = '0.5';
            
            // Optimistic removal
            setTimeout(() => {
                itemToRemove.remove();
                if (blockedDomainsList.children.length === 0) {
                    blockedDomainsList.innerHTML = '<p>No domains are currently blocked.</p>';
                }
            }, 300); // Small delay for visual effect

            try {
                const response = await fetch('/api/admin/blocked-domains', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminPassword}` }, body: JSON.stringify({ domain }) });
                if (!response.ok) throw new Error('Server rejected the request.');
                showAdminToast(`Domain "${domain}" unblocked.`, 'success');
            } catch (error) {
                showAdminToast(`Failed to unblock "${domain}". Reverting.`, 'error');
                addDomainToList(domain); // Re-add on failure
            }
        });
    }

    if (requestsList) {
        requestsList.addEventListener('click', (e) => {
            const copyBtn = e.target.closest('.request-copy-btn');
            if (copyBtn) {
                const urlToCopy = copyBtn.dataset.url;
                navigator.clipboard.writeText(urlToCopy).then(() => {
                    showAdminToast('URL copied to clipboard!', 'success');
                }).catch(err => {
                    showAdminToast('Failed to copy URL.', 'error');
                    console.error('Clipboard error:', err);
                });
            }
        });
    }

    // --- Initial Application State ---
    if (adminPassword) {
        showDashboard();
    } else {
        showLogin();
    }
});
