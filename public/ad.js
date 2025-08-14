// admin.js - Modernized with Optimistic UI and Toasts

document.addEventListener('DOMContentLoaded', () => {
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

    // NEW: Simple Toast Implementation for Admin page
    const showAdminToast = (message, type = 'info') => {
        // In a larger app, this would be a shared module. For simplicity, it's redefined here.
        const toastContainer = document.querySelector('.admin-container'); // Use container as anchor
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.zIndex = '9999';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    };

    const showLogin = () => { loginContainer.classList.remove('hidden'); dashboardContainer.classList.add('hidden'); passwordInput.value = ''; };
    const showDashboard = () => { loginContainer.classList.add('hidden'); dashboardContainer.classList.remove('hidden'); fetchDashboardData(); };

    const fetchDashboardData = async () => { /* ... no changes needed in this function, but it will be called less often ... */ if (!adminPassword) return showLogin(); const headers = { 'Authorization': `Bearer ${adminPassword}` }; try { const responses = await Promise.all([ fetch('/api/admin/stats', { headers }), fetch('/api/admin/requests', { headers }), fetch('/api/admin/blocked-domains', { headers }), fetch('/api/admin/settings', { headers }) ]); const unauthorizedResponse = responses.find(res => res.status === 401); if (unauthorizedResponse) { sessionStorage.removeItem('admin_password'); adminPassword = null; loginError.textContent = "Your session has expired. Please log in again."; loginError.classList.remove('hidden'); return showLogin(); } const failedResponse = responses.find(res => !res.ok); if (failedResponse) { const errorData = await failedResponse.json().catch(() => ({error: 'An unknown error occurred.'})); throw new Error(errorData.error); } const [stats, requests, domains, settings] = await Promise.all(responses.map(res => res.json())); cacheSizeEl.textContent = stats.cacheSize; redirectToggle.checked = settings.is_redirect_mode_enabled; logSizeEl.textContent = requests.length; requestsList.innerHTML = ''; if (requests.length === 0) { requestsList.innerHTML = '<p>No recent requests to display.</p>'; } else { requests.forEach(req => { const item = document.createElement('div'); item.className = 'request-item'; const timestamp = new Date(req.timestamp).toLocaleString(); item.innerHTML = `<span class="timestamp">${timestamp}</span> <span class="url" title="${req.url}">${req.url}</span>`; requestsList.appendChild(item); }); } blockedDomainsList.innerHTML = ''; if (domains.length === 0) { blockedDomainsList.innerHTML = '<p>No domains are currently blocked.</p>'; } else { domains.forEach(domain => addDomainToList(domain)); } } catch (error) { console.error("Failed to fetch dashboard data:", error); showAdminToast(`Failed to load dashboard data: ${error.message}`, 'error'); } };
    
    // NEW: Helper to add a domain to the list UI
    const addDomainToList = (domain) => {
        const placeholder = blockedDomainsList.querySelector('p');
        if (placeholder) placeholder.remove();
        const item = document.createElement('div');
        item.className = 'request-item';
        item.dataset.domain = domain; // For easy selection
        item.innerHTML = `<span class="url">${domain}</span><button class="remove-btn" data-domain="${domain}" title="Unblock ${domain}">×</button>`;
        blockedDomainsList.appendChild(item);
    };

    loginForm.addEventListener('submit', async (e) => { e.preventDefault(); const password = passwordInput.value; try { const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), }); const data = await response.json(); if (data.success) { adminPassword = password; sessionStorage.setItem('admin_password', password); loginError.classList.add('hidden'); showDashboard(); } else { loginError.textContent = data.error || 'Login failed.'; loginError.classList.remove('hidden'); } } catch (error) { loginError.textContent = 'An error occurred during login.'; loginError.classList.remove('hidden'); } });
    logoutBtn.addEventListener('click', () => { adminPassword = null; sessionStorage.removeItem('admin_password'); showLogin(); });
    clearCacheBtn.addEventListener('click', async () => { if (!adminPassword || !confirm("Are you sure?")) return; clearCacheBtn.disabled = true; clearCacheBtn.textContent = 'Clearing...'; try { await fetch('/api/admin/clear-cache', { method: 'POST', headers: { 'Authorization': `Bearer ${adminPassword}` } }); fetchDashboardData(); showAdminToast('Cache cleared successfully.', 'success'); } catch (error) { console.error("Failed to clear cache:", error); showAdminToast("Failed to clear cache.", 'error'); } finally { clearCacheBtn.disabled = false; clearCacheBtn.textContent = 'Clear Cache'; } });
    redirectToggle.addEventListener('change', async () => { if (!adminPassword) return; const isEnabled = redirectToggle.checked; try { await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminPassword}` }, body: JSON.stringify({ is_redirect_mode_enabled: isEnabled }) }); showAdminToast('Setting updated.', 'success'); } catch (error) { console.error("Failed to update setting:", error); showAdminToast("Failed to update download mode setting.", 'error'); redirectToggle.checked = !isEnabled; } });
    
    // MODIFIED: Block Domain with Optimistic UI
    blockDomainForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const domain = domainInput.value.trim();
        if (!adminPassword || !domain) return;

        // 1. Optimistic Update: Add to UI immediately
        addDomainToList(domain);
        const originalValue = domainInput.value;
        domainInput.value = '';

        try {
            const response = await fetch('/api/admin/blocked-domains', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminPassword}` }, body: JSON.stringify({ domain }) });
            if (!response.ok) throw new Error('Server rejected the request.');
            showAdminToast(`Domain "${domain}" blocked.`, 'success');
        } catch (error) {
            // 2. Revert on failure
            showAdminToast(`Failed to block domain "${domain}".`, 'error');
            const itemToRemove = blockedDomainsList.querySelector(`div[data-domain="${domain}"]`);
            if (itemToRemove) itemToRemove.remove();
            domainInput.value = originalValue; // Restore input
            if (blockedDomainsList.children.length === 0) {
                 blockedDomainsList.innerHTML = '<p>No domains are currently blocked.</p>';
            }
        }
    });

    // MODIFIED: Unblock Domain with Optimistic UI
    blockedDomainsList.addEventListener('click', async (e) => {
        if (!e.target.classList.contains('remove-btn')) return;
        
        const domain = e.target.dataset.domain;
        if (!adminPassword || !confirm(`Unblock "${domain}"?`)) return;

        const itemToRemove = e.target.closest('.request-item');
        
        // 1. Optimistic Update: Remove from UI immediately
        itemToRemove.style.opacity = '0.5'; // Visual feedback
        itemToRemove.remove();
        if (blockedDomainsList.children.length === 0) {
            blockedDomainsList.innerHTML = '<p>No domains are currently blocked.</p>';
        }

        try {
            const response = await fetch('/api/admin/blocked-domains', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminPassword}` }, body: JSON.stringify({ domain }) });
            if (!response.ok) throw new Error('Server rejected the request.');
            showAdminToast(`Domain "${domain}" unblocked.`, 'success');
        } catch (error) {
            // 2. Revert on failure
            showAdminToast(`Failed to unblock "${domain}".`, 'error');
            // Re-add the item to the list
            addDomainToList(domain);
        }
    });

    if (adminPassword) { showDashboard(); } else { showLogin(); }
});
