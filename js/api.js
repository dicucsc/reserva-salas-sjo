// ============================================
// API - Comunicación con Google Apps Script
// ============================================

const API_URL = 'https://script.google.com/macros/s/AKfycbzS7vTJPY88GmVUULiQnCoCpSipxloABhiVnNRFfdFtubmdtk56Uzoes1UjUV9_Tpxk/exec';

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

  init() {
    return this.get({ action: 'init' });
  },

  login(email) {
    return this.get({ action: 'login', email });
  },

  getLabs() {
    return this.get({ action: 'getLabs' });
  },

  getBlocks() {
    return this.get({ action: 'getBlocks' });
  },

  getEquipment() {
    return this.get({ action: 'getEquipment' });
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

  getAvailability(labId, fecha, bloqueId) {
    return this.get({ action: 'getAvailability', labId, fecha, bloqueId });
  },

  createReservation(data) {
    return this.post({ action: 'createReservation', ...data });
  },

  cancelReservation(reservaId, email) {
    return this.post({ action: 'cancelReservation', reservaId, email });
  }
};
