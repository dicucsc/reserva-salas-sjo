/* ============================================
   API - Comunicación con Azure Functions
   Sistema de Reserva de Salas SJO
   ============================================ */

const API_URL = '/api';

const Api = {
  async _get(endpoint, params) {
    const url = new URL(API_URL + '/' + endpoint, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const res = await fetch(url.toString());
    if (res.status === 401) {
      Auth.login();
      throw new Error('No autenticado');
    }
    return res.json();
  },

  async _post(endpoint, body) {
    const res = await fetch(API_URL + '/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) {
      Auth.login();
      throw new Error('No autenticado');
    }
    return res.json();
  },

  fullInit: () => Api._get('fullInit'),
  getUserProfile: () => Api._get('getUserProfile'),
  getYearCompact: (year) => Api._get('getYearCompact', { year }),
  createReservation: (data) => Api._post('createReservation', data),
  cancelReservation: (id) => Api._post('cancelReservation', { reservaId: id }),
  cancelRecurrenceGroup: (g) => Api._post('cancelRecurrenceGroup', { recurrenciaGrupo: g }),
  updateReservation: (data) => Api._post('updateReservation', data)
};
