/* ============================================
   API - Comunicación con Azure Functions
   Sistema de Reserva de Salas SJO
   ============================================ */

const API_URL = '/api';

const Api = {
  _timeout: 15000,

  async _get(endpoint, params) {
    const url = new URL(API_URL + '/' + endpoint, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (res.status === 401) {
        Auth.login();
        throw new Error('No autenticado');
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  },

  async _post(endpoint, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    try {
      const res = await fetch(API_URL + '/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (res.status === 401) {
        Auth.login();
        throw new Error('No autenticado');
      }
      const text = await res.text();
      if (!text) {
        throw new Error('Respuesta vacía del servidor (HTTP ' + res.status + ')');
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('Respuesta no válida (HTTP ' + res.status + '): ' + text.substring(0, 100));
      }
    } finally {
      clearTimeout(timer);
    }
  },

  fullInit: () => Api._get('fullInit'),
  getUserProfile: () => Api._get('getUserProfile'),
  getYearCompact: (year) => Api._get('getYearCompact', { year }),
  createReservation: (data) => Api._post('createReservation', data),
  cancelReservation: (id, fecha) => Api._post('cancelReservation', { reservaId: id, fecha }),
  cancelRecurrenceGroup: (g) => Api._post('cancelRecurrenceGroup', { recurrenciaGrupo: g }),
  updateReservation: (data) => Api._post('updateReservation', data),
  adminConfig: (resource, action, data) => Api._post('adminConfig', { resource, action, data: data || {} })

};
