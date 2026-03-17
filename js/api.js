/* ============================================
   API - Comunicación con Google Apps Script
   Sistema de Reserva de Salas SJO
   ============================================ */

const API_URL = 'https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec';

const Api = {
  async get(params) {
    const url = new URL(API_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    return res.json();
  },

  async post(body) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    });
    return res.json();
  },

  fullInit(fecha) {
    return this.get({ action: 'fullInit', fecha });
  },

  login(email) {
    return this.get({ action: 'login', email });
  },

  getReservations(fecha) {
    return this.get({ action: 'getReservations', fecha });
  },

  getWeek(fecha) {
    return this.get({ action: 'getWeek', fecha });
  },

  getMonth(fecha) {
    return this.get({ action: 'getMonth', fecha });
  },

  createReservation(data) {
    return this.post({ action: 'createReservation', ...data });
  },

  cancelReservation(reservaId, email) {
    return this.post({ action: 'cancelReservation', reservaId, email });
  },

  cancelRecurrenceGroup(recurrenciaGrupo, email) {
    return this.post({ action: 'cancelRecurrenceGroup', recurrenciaGrupo, email });
  }
};
