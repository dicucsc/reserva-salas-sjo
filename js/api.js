/* ============================================
   API - Comunicación con Google Apps Script
   Sistema de Reserva de Salas SJO
   ============================================ */

const API_URL = 'https://script.google.com/macros/s/AKfycbwp0prNjVgGKR5rgTi_NgdsOC2WStU2j0GA3wL3rR10MKuFxl-rWn6sF1ENocYbZbjf/exec';

const Api = {
  async _get(params) {
    const url = new URL(API_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    return res.json();
  },

  async _post(body) {
    const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
    return res.json();
  },

  fullInit: () => Api._get({ action: 'fullInit' }),
  login: (email) => Api._get({ action: 'login', email }),
  getYearCompact: (year) => Api._get({ action: 'getYearCompact', year }),
  createReservation: (data) => Api._post({ action: 'createReservation', ...data }),
  cancelReservation: (id, email) => Api._post({ action: 'cancelReservation', reservaId: id, email }),
  cancelRecurrenceGroup: (g, email) => Api._post({ action: 'cancelRecurrenceGroup', recurrenciaGrupo: g, email })
};
