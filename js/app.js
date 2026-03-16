// ============================================
// App Principal - Autenticación, Navegación y Reservas
// ============================================

const App = {
  currentUser: null,
  currentReservation: null, // { labId, labName, fecha, bloques: [{ bloqueId, bloqueLabel }] }

  async init() {
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.onclick = (e) => {
        e.preventDefault();
        this.showView(el.dataset.nav);
      };
    });

    document.getElementById('btn-login').onclick = () => this.login();
    document.getElementById('login-email').onkeydown = (e) => {
      if (e.key === 'Enter') this.login();
    };
    document.getElementById('btn-logout').onclick = () => this.logout();

    const savedEmail = localStorage.getItem('userEmail');
    if (savedEmail) {
      document.getElementById('login-email').value = savedEmail;
      await this.login(true);
    }
  },

  // --- Autenticación ---

  async login(silent) {
    const email = document.getElementById('login-email').value.trim();
    if (!email) {
      if (!silent) alert('Ingresa tu correo');
      return;
    }

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Verificando...';
    document.getElementById('login-error').classList.add('d-none');

    try {
      const res = await Api.login(email);
      if (res.ok) {
        this.currentUser = res.data;
        localStorage.setItem('userEmail', email);
        localStorage.setItem('userName', res.data.Nombre);
        this.showApp();
      } else {
        if (!silent) {
          document.getElementById('login-error').textContent = res.error;
          document.getElementById('login-error').classList.remove('d-none');
        }
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userName');
      }
    } catch (err) {
      if (!silent) {
        document.getElementById('login-error').textContent = 'Error de conexión: ' + err.message;
        document.getElementById('login-error').classList.remove('d-none');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  },

  logout() {
    this.currentUser = null;
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    document.getElementById('login-screen').classList.remove('d-none');
    document.getElementById('app-container').classList.add('d-none');
    document.getElementById('login-email').value = '';
    document.getElementById('login-error').classList.add('d-none');
    document.getElementById('user-display').textContent = '';
  },

  async showApp() {
    document.getElementById('login-screen').classList.add('d-none');
    document.getElementById('app-container').classList.remove('d-none');
    document.getElementById('user-display').textContent =
      `${this.currentUser.Nombre} (${this.currentUser.Email})`;

    try {
      await Calendar.init();
    } catch (err) {
      document.getElementById('calendar-grid').innerHTML =
        `<div class="alert alert-danger">Error al conectar con la API.<br><small>${err.message}</small></div>`;
    }
  },

  showView(view) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('d-none'));
    document.getElementById('view-' + view).classList.remove('d-none');

    document.querySelectorAll('[data-nav]').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-nav="${view}"]`)?.classList.add('active');

    if (view === 'mis-reservas') this.loadMyReservations();
  },

  // --- Flujo de reserva (multi-bloque) ---

  openMultiReservation(selection) {
    if (!this.currentUser || selection.length === 0) return;

    const sorted = [...selection].sort((a, b) => Number(a.bloqueId) - Number(b.bloqueId));
    const labId = sorted[0].labId;
    const labName = sorted[0].labName;
    const fecha = sorted[0].fecha;
    const bloques = sorted.map(s => ({ bloqueId: s.bloqueId, bloqueLabel: s.bloqueLabel }));

    this.currentReservation = { labId, labName, fecha, bloques };
    Equipment.reset();

    document.getElementById('res-lab-info').textContent = labName;
    document.getElementById('res-fecha-info').textContent = fecha;
    document.getElementById('res-bloque-info').textContent =
      bloques.map(b => b.bloqueLabel).join(' + ');
    document.getElementById('res-user-info').textContent =
      `${this.currentUser.Nombre} (${this.currentUser.Email})`;
    document.getElementById('res-actividad').value = '';

    this.showReservationStep(1);
    const modal = new bootstrap.Modal(document.getElementById('reservationModal'));
    modal.show();
  },

  showReservationStep(step) {
    document.getElementById('res-step-1').classList.toggle('d-none', step !== 1);
    document.getElementById('res-step-2').classList.toggle('d-none', step !== 2);
    document.getElementById('btn-res-back').classList.toggle('d-none', step === 1);
    document.getElementById('btn-res-next').classList.toggle('d-none', step !== 1);
    document.getElementById('btn-res-confirm').classList.toggle('d-none', step !== 2);
  },

  async goToStep2() {
    const actividad = document.getElementById('res-actividad').value.trim();
    if (!actividad) {
      alert('Indica la actividad o motivo de la reserva');
      return;
    }

    const { labId, fecha, bloques } = this.currentReservation;
    document.getElementById('equipment-list').innerHTML =
      '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div> Cargando equipos...</div>';
    this.showReservationStep(2);

    // Cargar disponibilidad del primer bloque (referencia)
    await Equipment.loadAvailability(labId, fecha, bloques[0].bloqueId);
    Equipment.renderCategoryFilter('equip-category');
    Equipment.renderSelector('equipment-list');

    document.getElementById('equip-search').oninput = () =>
      Equipment.renderSelector('equipment-list');
    document.getElementById('equip-category').onchange = () =>
      Equipment.renderSelector('equipment-list');
  },

  async confirmReservation() {
    const btn = document.getElementById('btn-res-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Confirmando...';

    const actividad = document.getElementById('res-actividad').value.trim();
    const { labId, fecha, bloques } = this.currentReservation;
    const equipos = Equipment.getSelectedList().map(e => ({
      equipoId: e.equipoId,
      cantidad: e.cantidad
    }));

    try {
      const bloqueIds = bloques.map(b => b.bloqueId);
      const res = await Api.createReservation({
        labId, fecha,
        bloqueIds, // array de bloques
        email: this.currentUser.Email,
        nombre: this.currentUser.Nombre,
        actividad, equipos
      });

      if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('reservationModal')).hide();
        const n = bloqueIds.length;
        this.showToast(`${n} reserva(s) creada(s) exitosamente`, 'success');
        Calendar.clearSelection();
        await Calendar.loadAndRender();
      } else {
        alert('Error: ' + res.error);
      }
    } catch (err) {
      alert('Error de conexión: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Confirmar Reserva';
    }
  },

  // --- Mis Reservas ---

  async loadMyReservations() {
    if (!this.currentUser) return;

    const email = this.currentUser.Email;
    const container = document.getElementById('my-reservations-list');
    document.getElementById('my-email-display').textContent =
      `${this.currentUser.Nombre} (${email})`;
    container.innerHTML = '<div class="text-center py-3"><div class="spinner-border"></div></div>';

    try {
      const res = await Api.getMonth(Calendar.formatDate(new Date()));
      if (!res.ok) {
        container.innerHTML = '<div class="alert alert-danger">Error al cargar reservas</div>';
        return;
      }

      const myReservations = res.data.filter(r =>
        String(r.Email).trim().toLowerCase() === email.trim().toLowerCase()
      );
      this.myReservationsCache = myReservations;

      if (myReservations.length === 0) {
        container.innerHTML = '<div class="alert alert-info">No tienes reservas este mes</div>';
        return;
      }

      const blocksMap = {};
      Calendar.blocks.forEach(b => { blocksMap[b.ID] = b.Etiqueta; });
      const labsMap = {};
      Calendar.labs.forEach(l => { labsMap[l.ID] = l.Nombre; });

      let html = '';
      myReservations.sort((a, b) => a.Fecha.localeCompare(b.Fecha) || a.BloqueID - b.BloqueID);

      myReservations.forEach(r => {
        const equipHtml = r.equipos && r.equipos.length > 0
          ? '<ul class="mb-0 mt-1">' + r.equipos.map(eq => {
              const eqInfo = Equipment.allEquipment.find(e => String(e.ID) === String(eq.EquipoID));
              return `<li>${eqInfo ? eqInfo.Nombre : 'Equipo ' + eq.EquipoID} × ${eq.Cantidad}</li>`;
            }).join('') + '</ul>'
          : '<small class="text-muted">Sin equipos</small>';

        html += `
          <div class="card mb-3">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start">
                <div>
                  <h6 class="card-title mb-1">${labsMap[r.LabID] || 'Lab ' + r.LabID}</h6>
                  <p class="mb-1"><strong>${r.Fecha}</strong> — ${blocksMap[r.BloqueID] || 'Bloque ' + r.BloqueID}</p>
                  ${r.Actividad ? `<p class="mb-1 text-muted">${r.Actividad}</p>` : ''}
                  <div><strong>Equipos:</strong> ${equipHtml}</div>
                </div>
                <button class="btn btn-outline-danger btn-sm" onclick="App.cancelReservation('${r.ID}')">
                  Cancelar
                </button>
              </div>
            </div>
          </div>`;
      });

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">Error: ${err.message}</div>`;
    }
  },

  // --- Cancelación desde grilla (click en celda propia) ---

  pendingCancelId: null,

  openCancelModal(reservaId) {
    const reserva = Calendar.reservations.find(r => String(r.ID) === String(reservaId));
    if (!reserva) return;

    this.pendingCancelId = reservaId;

    const blocksMap = {};
    Calendar.blocks.forEach(b => { blocksMap[b.ID] = b.Etiqueta; });
    const labsMap = {};
    Calendar.labs.forEach(l => { labsMap[l.ID] = l.Nombre; });

    const equipHtml = reserva.equipos && reserva.equipos.length > 0
      ? '<ul class="mb-1">' + reserva.equipos.map(eq => {
          const eqInfo = Equipment.allEquipment.find(e => String(e.ID) === String(eq.EquipoID));
          return `<li>${eqInfo ? eqInfo.Nombre : 'Equipo ' + eq.EquipoID} x ${eq.Cantidad}</li>`;
        }).join('') + '</ul>'
      : '';

    document.getElementById('cancel-modal-body').innerHTML = `
      <p>¿Deseas cancelar esta reserva?</p>
      <div class="card">
        <div class="card-body py-2">
          <strong>${labsMap[reserva.LabID] || 'Lab ' + reserva.LabID}</strong><br>
          ${reserva.Fecha} — ${blocksMap[reserva.BloqueID] || 'Bloque ' + reserva.BloqueID}<br>
          <span class="text-muted">${reserva.Actividad || ''}</span>
          ${equipHtml ? '<br><strong>Equipos:</strong>' + equipHtml : ''}
        </div>
      </div>`;

    const modal = new bootstrap.Modal(document.getElementById('cancelModal'));
    modal.show();
  },

  async confirmCancel() {
    if (!this.pendingCancelId) return;

    const btn = document.getElementById('btn-cancel-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Cancelando...';

    try {
      const res = await Api.cancelReservation(this.pendingCancelId, this.currentUser.Email);
      if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('cancelModal')).hide();
        this.showToast('Reserva cancelada', 'success');
        await Calendar.loadAndRender();
        // Refrescar "Mis Reservas" si está visible
        if (!document.getElementById('view-mis-reservas').classList.contains('d-none')) {
          this.loadMyReservations();
        }
      } else {
        alert('Error: ' + res.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Confirmar Cancelación';
      this.pendingCancelId = null;
    }
  },

  myReservationsCache: [],

  async cancelReservation(reservaId) {
    // Desde "Mis Reservas": la reserva puede no estar en Calendar.reservations
    // así que buscamos en el cache local
    const reserva = this.myReservationsCache.find(r => String(r.ID) === String(reservaId));
    if (!reserva) {
      if (!confirm('¿Seguro que quieres cancelar esta reserva?')) return;
      try {
        const res = await Api.cancelReservation(reservaId, this.currentUser.Email);
        if (res.ok) {
          this.showToast('Reserva cancelada', 'success');
          this.loadMyReservations();
          Calendar.loadAndRender();
        } else { alert('Error: ' + res.error); }
      } catch (err) { alert('Error: ' + err.message); }
      return;
    }
    // Si tenemos la data, inyectarla temporalmente para el modal
    if (!Calendar.reservations.find(r => String(r.ID) === String(reservaId))) {
      Calendar.reservations.push(reserva);
    }
    this.openCancelModal(reservaId);
  },

  showToast(message, type) {
    const container = document.getElementById('toast-container');
    const id = 'toast-' + Date.now();
    container.innerHTML = `
      <div id="${id}" class="toast align-items-center text-bg-${type} border-0 show" role="alert">
        <div class="d-flex">
          <div class="toast-body">${message}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>`;
    setTimeout(() => document.getElementById(id)?.remove(), 4000);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
