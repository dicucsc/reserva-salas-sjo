/* ============================================
   Auth - Azure Static Web Apps Built-in Auth
   Sistema de Reserva de Salas SJO
   ============================================ */

const Auth = {
  _cachedPrincipal: undefined,

  async getUserInfo() {
    if (this._cachedPrincipal !== undefined) return this._cachedPrincipal;

    try {
      const res = await fetch('/.auth/me');
      const data = await res.json();
      this._cachedPrincipal = data.clientPrincipal || null;
    } catch {
      this._cachedPrincipal = null;
    }
    return this._cachedPrincipal;
  },

  login() {
    window.location.href = '/login';
  },

  logout() {
    this._cachedPrincipal = undefined;
    window.location.href = '/logout';
  },

  async isAuthenticated() {
    const user = await this.getUserInfo();
    return !!user;
  },

  clearCache() {
    this._cachedPrincipal = undefined;
  }
};
