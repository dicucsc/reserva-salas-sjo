/* ============================================
   App Principal - Autenticación, Navegación y Reservas
   Sistema de Reserva de Salas SJO
   ============================================ */

const App = {
  currentUser: null,
  _modalReservar: null,
  _modalCancelar: null,

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

    const savedEmail = localStorage.getItem('sjo_email');
    if (savedEmail) {
      document.getElementById('login-email').value = savedEmail;
      await this.login(true);
    }
  },

  // ── Email helper ───────────────────────────────────────

  isMyEmail(email) {
    return String(email).trim().toLowerCase() === this.currentUser?.Email?.trim().toLowerCase();
  },

  // ── Autenticación ─────────────────────────────────────

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
        localStorage.setItem('sjo_email', email);
        localStorage.setItem('sjo_nombre', res.data.Nombre);
        this.showApp();
      } else {
        if (!silent) {
          document.getElementById('login-error').textContent = res.error;
          document.getElementById('login-error').classList.remove('d-none');
        }
      }
    } catch (e) {
      if (!silent) {
        document.getElementById('login-error').textContent = 'Error de conexión: ' + e.message;
        document.getElementById('login-error').classList.remove('d-none');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  },

  showApp() {
    document.getElementById('login-screen').classList.add('d-none');
    document.getElementById('app-container').classList.remove('d-none');
    document.getElementById('user-display').textContent = this.currentUser.Nombre;

    // Cache modal instances
    this._modalReservar = new bootstrap.Modal(document.getElementById('reservationModal'));
    this._modalCancelar = new bootstrap.Modal(document.getElementById('cancelModal'));

    this.showView('calendario');
    Calendar.init();
  },

  logout() {
    this.currentUser = null;
    localStorage.removeItem('sjo_email');
    localStorage.removeItem('sjo_nombre');
    Calendar.stopAutoRefresh();
    this._modalReservar = null;
    this._modalCancelar = null;
    document.getElementById('login-screen').classList.remove('d-none');
    document.getElementById('app-container').classList.add('d-none');
  },

  // ── Navegación ────────────────────────────────────────

  showView(name) {
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('d-none'));
    document.getElementById('view-' + name).classList.remove('d-none');
    document.querySelectorAll('[data-nav]').forEach(l => l.classList.remove('active'));
    document.querySelector(`[data-nav="${name}"]`)?.classList.add('active');

    if (name === 'mis-reservas') this.loadMyReservations();
    if (name === 'resumen-diario') this.loadDailySummary();
  },

  // ── Modal de Reserva ──────────────────────────────────

  openMultiReservation(selections) {
    this._reservationSelections = selections;

    // Summary
    const groups = {};
    selections.forEach(s => {
      const key = `${s.salaId}|${s.fecha}`;
      if (!groups[key]) groups[key] = { salaName: s.salaName, fecha: s.fecha, bloques: [] };
      groups[key].bloques.push(s.bloqueLabel);
    });

    let infoHtml = Object.values(groups).map(g =>
      `<strong>${g.salaName}</strong> — ${g.fecha} — ${g.bloques.join(', ')}`
    ).join('<br>');

    document.getElementById('res-slots-info').innerHTML = infoHtml;
    document.getElementById('res-user-info').textContent = this.currentUser.Nombre + ' (' + this.currentUser.Email + ')';
    document.getElementById('res-actividad').value = '';
    document.getElementById('res-comentarios').value = '';
    this.populateEquipmentCheckboxes();

    // Recurrence
    document.getElementById('res-recurrence-check').checked = false;
    document.getElementById('res-recurrence-options').classList.add('d-none');
    const until = new Date();
    until.setDate(until.getDate() + 21);
    document.getElementById('res-recurrence-until').value = Calendar.formatDate(until);

    this._modalReservar.show();
  },

  toggleResRecurrence() {
    const checked = document.getElementById('res-recurrence-check').checked;
    document.getElementById('res-recurrence-options').classList.toggle('d-none', !checked);
  },

  async confirmReservation() {
    const actividad = document.getElementById('res-actividad').value.trim();
    if (!actividad) { this.showToast('Ingresa la actividad', 'warning'); return; }

    let allSlots = this._reservationSelections.map(s => ({
      salaId: s.salaId, fecha: s.fecha, bloqueId: s.bloqueId
    }));

    let recurrenciaGrupo = '';
    const isRecurrent = document.getElementById('res-recurrence-check').checked;
    if (isRecurrent) {
      const until = document.getElementById('res-recurrence-until').value;
      if (!until) { this.showToast('Selecciona fecha límite', 'warning'); return; }
      recurrenciaGrupo = 'REC-' + Date.now();
      const untilDate = new Date(until + 'T00:00:00');

      for (const s of this._reservationSelections) {
        const baseDate = new Date(s.fecha + 'T00:00:00');
        let nextDate = new Date(baseDate);
        nextDate.setDate(nextDate.getDate() + 7);
        while (nextDate <= untilDate) {
          const y = nextDate.getFullYear();
          const m = String(nextDate.getMonth() + 1).padStart(2, '0');
          const d = String(nextDate.getDate()).padStart(2, '0');
          allSlots.push({ salaId: s.salaId, fecha: `${y}-${m}-${d}`, bloqueId: s.bloqueId });
          nextDate.setDate(nextDate.getDate() + 7);
        }
      }
    }

    const btn = document.getElementById('btn-res-confirm');
    btn.disabled = true;
    btn.textContent = 'Reservando...';

    const comentarios = document.getElementById('res-comentarios').value.trim();
    const equipos = [];
    document.querySelectorAll('#res-equipos-container input[type="checkbox"]:checked').forEach(cb => {
      equipos.push(Number(cb.value));
    });

    try {
      const res = await Api.createReservation({
        slots: allSlots,
        email: this.currentUser.Email,
        actividad,
        recurrenciaGrupo,
        comentarios,
        equipos
      });

      if (res.ok) {
        this.showToast(`Reserva confirmada (${allSlots.length} bloque${allSlots.length > 1 ? 's' : ''})`, 'success');
        this._modalReservar.hide();
        Calendar.clearSelection();
        Calendar.invalidateCache();
        Calendar.loadAndRender();
      } else {
        this.showToast(res.error || 'Error al reservar', 'error');
      }
    } catch (e) {
      this.showToast('Error de conexión', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar Reserva';
    }
  },

  // ── Cancelación ───────────────────────────────────────

  openBulkCancel() {
    if (Calendar.cancelSelection.length === 0) return;
    this._cancelItems = Calendar.cancelSelection.slice();

    const h = ['<p>¿Cancelar estas reservas?</p><ul>'];
    this._cancelItems.forEach(s => {
      h.push(`<li><strong>${s.salaName}</strong> — ${s.fecha} — ${s.bloqueLabel}</li>`);
    });
    h.push('</ul>');
    document.getElementById('cancel-modal-body').innerHTML = h.join('');
    this._modalCancelar.show();
  },

  async confirmCancel() {
    const btn = document.getElementById('btn-cancel-confirm');
    btn.disabled = true;
    btn.textContent = 'Cancelando...';

    try {
      let errors = [];
      for (const s of this._cancelItems) {
        const res = await Api.cancelReservation(s.reservaId, this.currentUser.Email);
        if (!res.ok) errors.push(res.error);
      }

      if (errors.length === 0) {
        this.showToast(`${this._cancelItems.length} reserva(s) cancelada(s)`, 'success');
      } else {
        this.showToast(`Errores: ${errors.join(', ')}`, 'error');
      }

      this._modalCancelar.hide();
      Calendar.clearCancelSelection();
      Calendar.invalidateCache();
      Calendar.loadAndRender();
    } catch (e) {
      this.showToast('Error de conexión', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar Cancelación';
    }
  },

  // ── Mis Reservas ──────────────────────────────────────

  loadMyReservations() {
    const container = document.getElementById('my-reservations-list');
    document.getElementById('my-email-display').textContent = '(' + this.currentUser.Email + ')';

    const today = Calendar.formatDate(new Date());
    const mine = Calendar.allReservations
      .filter(r => this.isMyEmail(r.Email) && r.Fecha >= today)
      .sort((a, b) => (a.Fecha > b.Fecha ? 1 : -1));

    if (mine.length === 0) {
      container.innerHTML = '<p class="text-muted">No tienes próximas reservas.</p>';
      return;
    }

    // Group by recurrence
    const groups = {};
    const singles = [];
    mine.forEach(r => {
      if (r.Recurrencia) {
        if (!groups[r.Recurrencia]) groups[r.Recurrencia] = [];
        groups[r.Recurrencia].push(r);
      } else {
        singles.push(r);
      }
    });

    const h = [];

    // Recurring groups
    Object.entries(groups).forEach(([groupId, reservas]) => {
      const sala = Calendar.salas.find(l => l.ID === reservas[0].SalaID);
      h.push(`<div class="card mb-3">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <span class="badge bg-primary">Recurrente (${reservas.length} bloques)</span>
              <h6 class="mt-1 mb-0">${sala?.Nombre || 'Sala'} — ${reservas[0].Actividad}</h6>
            </div>
            <button class="btn btn-outline-danger btn-sm" onclick="App.cancelRecurrenceGroup('${groupId}')">Cancelar grupo</button>
          </div>
          <ul class="mb-0" style="font-size:0.8125rem">
            ${reservas.map(r => {
              const bl = Calendar.bloques.find(b => b.ID === r.BloqueID);
              return `<li>${r.Fecha} — ${bl?.Etiqueta || ''}</li>`;
            }).join('')}
          </ul>
        </div>
      </div>`);
    });

    // Singles
    singles.forEach(r => {
      const sala = Calendar.salas.find(l => l.ID === r.SalaID);
      const bl = Calendar.bloques.find(b => b.ID === r.BloqueID);
      h.push(`<div class="card mb-2">
        <div class="card-body d-flex justify-content-between align-items-center">
          <div>
            <strong>${sala?.Nombre || 'Sala'}</strong> — ${r.Fecha} — ${bl?.Etiqueta || ''}
            <br><small class="text-muted">${r.Actividad}</small>
          </div>
          <button class="btn btn-outline-danger btn-sm" onclick="App.cancelSingle(${r.ID})">Cancelar</button>
        </div>
      </div>`);
    });

    container.innerHTML = h.join('');
  },

  async cancelSingle(id) {
    if (!confirm('¿Cancelar esta reserva?')) return;
    const res = await Api.cancelReservation(id, this.currentUser.Email);
    if (res.ok) {
      this.showToast('Reserva cancelada', 'success');
      this.loadMyReservations();
      Calendar.invalidateCache();
      Calendar.loadAndRender();
    } else {
      this.showToast(res.error || 'Error', 'error');
    }
  },

  async cancelRecurrenceGroup(groupId) {
    if (!confirm('¿Cancelar TODAS las reservas de este grupo recurrente?')) return;
    const res = await Api.cancelRecurrenceGroup(groupId, this.currentUser.Email);
    if (res.ok) {
      this.showToast(`${res.data.canceladas} reservas canceladas`, 'success');
      this.loadMyReservations();
      Calendar.invalidateCache();
      Calendar.loadAndRender();
    } else {
      this.showToast(res.error || 'Error', 'error');
    }
  },

  // ── Equipment Checkboxes ────────────────────────────

  populateEquipmentCheckboxes() {
    const container = document.getElementById('res-equipos-container');
    if (Calendar.equipos.length === 0) {
      container.innerHTML = '<small class="text-muted">No hay equipos disponibles</small>';
      return;
    }
    container.innerHTML = Calendar.equipos.map(eq =>
      `<div class="form-check">
        <input class="form-check-input" type="checkbox" value="${eq.ID}" id="eq-${eq.ID}">
        <label class="form-check-label" for="eq-${eq.ID}">
          ${eq.Nombre} <small class="text-muted">(${eq.Descripcion || ''} — ${eq.Cantidad} disponibles)</small>
        </label>
      </div>`
    ).join('');
  },

  // ── Resumen Diario ──────────────────────────────────

  loadDailySummary() {
    const picker = document.getElementById('summary-date-picker');
    if (!picker.value) {
      picker.value = Calendar.formatDate(new Date());
    }
    picker.onchange = () => this.renderDailySummary(picker.value);
    this.renderDailySummary(picker.value);
  },

  renderDailySummary(dateStr) {
    const container = document.getElementById('daily-summary-content');
    const reservas = Calendar.allReservations.filter(r => r.Fecha === dateStr);

    if (reservas.length === 0) {
      container.innerHTML = '<div class="summary-empty">No hay reservas para esta fecha.</div>';
      return;
    }

    // Group by BloqueID
    const byBloque = {};
    reservas.forEach(r => {
      if (!byBloque[r.BloqueID]) byBloque[r.BloqueID] = [];
      byBloque[r.BloqueID].push(r);
    });

    const bloqueIds = Object.keys(byBloque).map(Number).sort((a, b) => a - b);
    const h = [];

    bloqueIds.forEach(bid => {
      const bloque = Calendar.bloques.find(b => b.ID === bid);
      const bloqueLabel = bloque ? bloque.Etiqueta : 'Bloque ' + bid;
      const items = byBloque[bid].sort((a, b) => a.SalaID - b.SalaID);

      // Equipment totals for this block
      const eqTotals = {};
      items.forEach(r => {
        if (r.Equipos) {
          r.Equipos.split(',').forEach(eqId => {
            const id = eqId.trim();
            if (!id) return;
            const eq = Calendar.equipos.find(e => String(e.ID) === id);
            const name = eq ? eq.Nombre : 'Equipo ' + id;
            eqTotals[name] = (eqTotals[name] || 0) + 1;
          });
        }
      });

      h.push('<div class="summary-block">');
      h.push(`<div class="summary-block-header">${bloqueLabel}</div>`);

      const eqKeys = Object.keys(eqTotals);
      if (eqKeys.length > 0) {
        const eqText = eqKeys.map(k => eqTotals[k] + ' ' + k).join(', ');
        h.push(`<div class="summary-equipment-totals">Equipos necesarios: ${eqText}</div>`);
      }

      h.push('<table class="summary-table">');
      h.push('<thead><tr><th>Sala</th><th>Actividad</th><th>Persona</th><th>Comentarios</th><th>Equipos</th></tr></thead>');
      h.push('<tbody>');

      items.forEach(r => {
        const sala = Calendar.salas.find(s => s.ID === r.SalaID);
        const salaName = sala ? sala.Nombre : 'Sala ' + r.SalaID;
        const eqNames = r.Equipos ? r.Equipos.split(',').map(id => {
          const eq = Calendar.equipos.find(e => String(e.ID) === id.trim());
          return eq ? eq.Nombre : '';
        }).filter(Boolean).join(', ') : '-';

        h.push(`<tr>
          <td><strong>${salaName}</strong></td>
          <td>${r.Actividad || '-'}</td>
          <td>${r.Nombre}</td>
          <td>${r.Comentarios || '-'}</td>
          <td>${eqNames}</td>
        </tr>`);
      });

      h.push('</tbody></table></div>');
    });

    container.innerHTML = h.join('');
  },

  // ── Toast ─────────────────────────────────────────────

  showToast(message, type) {
    const container = document.getElementById('toast-container');
    const colors = { success: '#059669', error: '#dc2626', warning: '#d97706', info: '#3b5bdb' };
    const bg = colors[type] || colors.info;

    const el = document.createElement('div');
    el.className = 'toast align-items-center text-white border-0 show';
    el.style.background = bg;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.closest('.toast').remove()"></button></div>`;

    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
};

// Init
document.addEventListener('DOMContentLoaded', () => App.init());
