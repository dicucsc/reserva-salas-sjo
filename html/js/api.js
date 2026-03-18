/* ============================================
   API - Comunicación con Google Apps Script
   Sistema de Reserva de Salas SJO
   ============================================ */

const API_URL = 'https://script.google.com/macros/s/AKfycbw8bqY2kKkrmvT2uKH6ICDKoiqgSCezFNhb-TT5C5f6Y-5EvAtrVE-Cf88ZkuqBOkZi/exec';

const Api = {
  async _get(params) {
    const url = new URL(API_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { redirect: 'follow' });
    return res.json();
  },

  async _post(body) {
    const res = await fetch(API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return res.json();
  },

  fullInit: () => Api._get({ action: 'fullInit' }),
  login: (email, password) => Api._post({ action: 'login', email, password }),
  getYearCompact: (year) => Api._get({ action: 'getYearCompact', year }),
  createReservation: (data) => Api._post({ action: 'createReservation', ...data }),
  cancelReservation: (id, email) => Api._post({ action: 'cancelReservation', reservaId: id, email }),
  cancelRecurrenceGroup: (g, email) => Api._post({ action: 'cancelRecurrenceGroup', recurrenciaGrupo: g, email }),
  updateReservation: (data) => Api._post({ action: 'updateReservation', ...data })
};
