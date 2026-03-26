// auth.js - Authentication module (Supabase-backed)

const AUTH_KEY = 'nlpl_auth_user';

const Auth = {
  _usersCache: null,

  async login(userId, password) {
    const { data, error } = await db
      .from('it_solutions_users')
      .select('user_id, name, role, ho_or_co')
      .eq('user_id', userId.trim())
      .eq('password', password)
      .maybeSingle();

    if (error || !data) {
      return { success: false, message: 'Invalid User ID or Password.' };
    }

    const session = {
      id: data.user_id,
      name: data.name,
      role: data.role,
      hoOrCo: data.ho_or_co
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return { success: true, user: session };
  },

  logout() {
    localStorage.removeItem(AUTH_KEY);
    window.location.href = 'login.html';
  },

  getUser() {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  isLoggedIn() {
    return !!this.getUser();
  },

  requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  requireGuest() {
    if (this.isLoggedIn()) {
      window.location.href = 'dashboard.html';
      return false;
    }
    return true;
  },

  async getUsers() {
    if (this._usersCache) return this._usersCache;

    const { data, error } = await db
      .from('it_solutions_users')
      .select('user_id, name, role, ho_or_co');

    if (error || !data) return [];

    this._usersCache = data.map(u => ({
      id: u.user_id,
      name: u.name,
      role: u.role,
      hoOrCo: u.ho_or_co
    }));
    return this._usersCache;
  },

  async getUserById(userId) {
    const { data, error } = await db
      .from('it_solutions_users')
      .select('user_id, name, role, ho_or_co')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.user_id,
      name: data.name,
      role: data.role,
      hoOrCo: data.ho_or_co
    };
  }
};
