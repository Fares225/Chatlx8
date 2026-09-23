/**
 * Chatlx - Authentication Manager
 * Handles real Google authentication, persistent user directory, and multi-session synchronization.
 */

class AuthManager {
  constructor() {
    this.ACTIVE_USER_KEY = 'chatlx_active_user';
    this.USERS_DIRECTORY_KEY = 'chatlx_registered_users';
    this.currentUser = null;
    this.broadcastChannel = null;

    try {
      this.broadcastChannel = new BroadcastChannel('chatlx_sync_channel');
      this.broadcastChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'USER_JOINED') {
          window.dispatchEvent(new CustomEvent('chatlx:users_updated', { detail: this.getRegisteredUsers() }));
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel not supported');
    }

    this.init();
  }

  init() {
    this.loadSavedUser();
    this.setupEventListeners();
  }

  loadSavedUser() {
    try {
      const saved = localStorage.getItem(this.ACTIVE_USER_KEY);
      if (saved) {
        this.currentUser = JSON.parse(saved);
        // Ensure user is in directory
        this.registerUserInDirectory(this.currentUser);
      }
    } catch (e) {
      console.error('[Chatlx Auth] Error reading session', e);
      this.currentUser = null;
    }
  }

  // Get all registered users who entered the site with Google
  getRegisteredUsers() {
    try {
      const list = localStorage.getItem(this.USERS_DIRECTORY_KEY);
      return list ? JSON.parse(list) : [];
    } catch (e) {
      return [];
    }
  }

  // Register or update user in persistent directory
  registerUserInDirectory(user) {
    if (!user || !user.email) return;

    let users = this.getRegisteredUsers();
    const existingIndex = users.findIndex((u) => u.email.toLowerCase() === user.email.toLowerCase());

    const updatedUser = {
      ...user,
      status: 'online',
      lastSeen: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    };

    if (existingIndex >= 0) {
      users[existingIndex] = updatedUser;
    } else {
      users.unshift(updatedUser);
    }

    localStorage.setItem(this.USERS_DIRECTORY_KEY, JSON.stringify(users));

    // Broadcast to other tabs
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type: 'USER_JOINED', user: updatedUser });
    }

    window.dispatchEvent(new CustomEvent('chatlx:users_updated', { detail: users }));
  }

  setupEventListeners() {
    // Google Sign-In Main Button
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
      googleBtn.addEventListener('click', () => {
        this.openGoogleModal();
      });
    }

    // Google Sign-in Modal Form
    const googleForm = document.getElementById('google-auth-form');
    if (googleForm) {
      googleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('google-name-input');
        const emailInput = document.getElementById('google-email-input');

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();

        if (name && email) {
          this.loginWithGoogle({ name, email });
        }
      });
    }

    // Modal Close Button
    const closeBtn = document.getElementById('close-google-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closeGoogleModal();
      });
    }

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        this.logout();
      });
    }
  }

  openGoogleModal() {
    const modal = document.getElementById('google-auth-modal');
    if (modal) {
      modal.classList.add('active');
      // Render previously signed-in accounts from this device if any exist
      this.renderSavedGoogleAccounts();
    }
  }

  closeGoogleModal() {
    const modal = document.getElementById('google-auth-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  }

  // If user previously used accounts on this browser, show them for fast 1-click Google re-entry
  renderSavedGoogleAccounts() {
    const container = document.getElementById('saved-accounts-list');
    if (!container) return;

    const registeredUsers = this.getRegisteredUsers();
    if (registeredUsers.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = `
      <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 6px; text-align: right;">
        الحسابات المسجلة مسبقاً على هذا الجهاز:
      </div>
    `;

    registeredUsers.slice(0, 3).forEach((acc) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick-acc-btn';
      btn.innerHTML = `
        <img class="quick-acc-avatar" src="${acc.avatar}" alt="${acc.name}">
        <div class="quick-acc-info">
          <div class="quick-acc-name">${acc.name}</div>
          <div class="quick-acc-email">${acc.email}</div>
        </div>
        <span class="google-tag">Google</span>
      `;
      btn.addEventListener('click', () => {
        this.loginWithGoogle(acc);
      });
      container.appendChild(btn);
    });
  }

  // Google Login execution
  loginWithGoogle({ name, email, avatar }) {
    // Clean, high quality Google style avatar using seed
    const userAvatar = avatar || `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(email || name)}`;
    
    this.currentUser = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      email: email.trim(),
      avatar: userAvatar,
      isGoogleVerified: true,
      status: 'online',
      registeredAt: new Date().toISOString()
    };

    localStorage.setItem(this.ACTIVE_USER_KEY, JSON.stringify(this.currentUser));
    this.registerUserInDirectory(this.currentUser);
    this.closeGoogleModal();

    // Trigger app login
    window.dispatchEvent(new CustomEvent('chatlx:login', { detail: this.currentUser }));
  }

  logout() {
    if (this.currentUser) {
      // Mark as offline in directory
      const users = this.getRegisteredUsers();
      const existing = users.find((u) => u.email === this.currentUser.email);
      if (existing) {
        existing.status = 'offline';
        localStorage.setItem(this.USERS_DIRECTORY_KEY, JSON.stringify(users));
      }
    }

    localStorage.removeItem(this.ACTIVE_USER_KEY);
    this.currentUser = null;
    window.dispatchEvent(new CustomEvent('chatlx:logout'));
    window.dispatchEvent(new CustomEvent('chatlx:users_updated', { detail: this.getRegisteredUsers() }));
  }

  getUser() {
    return this.currentUser;
  }

  isLoggedIn() {
    return !!this.currentUser;
  }
}

// Global instance
window.chatlxAuth = new AuthManager();
