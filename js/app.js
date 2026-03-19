/* ============================================
   App Principal - Autenticación, Navegación y Reservas
   Sistema de Reserva de Salas SJO (Azure)
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

    document.getElementById('btn-login').onclick = () => Auth.login();
    document.getElementById('btn-logout').onclick = () => this.logout();

    // Try auto-login via SWA auth
    await this.tryAutoLogin();
  },

  // ── Email helper ───────────────────────────────────────

  isMyEmail(email) {
    return String(email).trim().toLowerCase() === this.currentUser?.Email?.trim().toLowerCase();
  },

  // ── Autenticación ─────────────────────────────────────

  async tryAutoLogin() {
    try {
      const principal = await Auth.getUserInfo();
      if (!principal) return; // Not authenticated, show login screen

      // User is authenticated with Microsoft, get profile from our DB
      const btn = document.getElementById('btn-login');
      btn.disabled = true;
      btn.textContent = 'Verificando...';

      const res = await Api.getUserProfile();
      if (res.ok) {
        this.currentUser = res.data;
        this.showApp();
      } else {
        // User authenticated with Microsoft but not in our Users table
        document.getElementById('login-error').textContent = res.error || 'Usuario no registrado';
        document.getElementById('login-error').classList.remove('d-none');
        btn.disabled = false;
        btn.textContent = 'Ingresar con cuenta UCSC';
      }
    } catch (e) {
      // Not authenticated or error, show login screen
      const btn = document.getElementById('btn-login');
      btn.disabled = false;
      btn.textContent = 'Ingresar con cuenta UCSC';
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
    Calendar.stopAutoRefresh();
    this._modalReservar = null;
    this._modalCancelar = null;
    Auth.logout();
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
    document.getElementById('res-responsable').value = this.currentUser.Nombre;
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

    const responsable = document.getElementById('res-responsable').value.trim() || this.currentUser.Nombre;
    const comentarios = document.getElementById('res-comentarios').value.trim();
    const equipos = [];
    document.querySelectorAll('#res-equipos-container input[type="checkbox"]:checked').forEach(cb => {
      equipos.push(Number(cb.value));
    });

    try {
      const res = await Api.createReservation({
        slots: allSlots,
        actividad,
        recurrenciaGrupo,
        comentarios,
        equipos,
        responsable
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
        const res = await Api.cancelReservation(s.reservaId);
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
    const res = await Api.cancelReservation(id);
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
    const res = await Api.cancelRecurrenceGroup(groupId);
    if (res.ok) {
      this.showToast(`${res.data.canceladas} reservas canceladas`, 'success');
      this.loadMyReservations();
      Calendar.invalidateCache();
      Calendar.loadAndRender();
    } else {
      this.showToast(res.error || 'Error', 'error');
    }
  },

  // ── Editar Reserva ──────────────────────────────────

  openEditReservation(reserva) {
    this._editReserva = reserva;

    const sala = Calendar.salas.find(s => s.ID === reserva.SalaID);
    const bloque = Calendar.bloques.find(b => b.ID === reserva.BloqueID);

    document.getElementById('edit-res-info').innerHTML =
      `<strong>${sala?.Nombre || 'Sala'}</strong> — ${reserva.Fecha} — ${bloque?.Etiqueta || ''}<br>
       <small class="text-muted">Reservado por: ${reserva.Nombre}</small>`;

    document.getElementById('edit-res-actividad').value = reserva.Actividad || '';
    document.getElementById('edit-res-responsable').value = reserva.Responsable || reserva.Nombre || '';
    document.getElementById('edit-res-comentarios').value = reserva.Comentarios || '';
    this.populateEditEquipmentCheckboxes(reserva.Equipos);

    if (!this._modalEditar) {
      this._modalEditar = new bootstrap.Modal(document.getElementById('editReservationModal'));
    }
    this._modalEditar.show();
  },

  populateEditEquipmentCheckboxes(currentEquipos) {
    const container = document.getElementById('edit-res-equipos-container');
    const selectedIds = currentEquipos ? currentEquipos.split(',').map(id => id.trim()) : [];
    const reserva = this._editReserva;

    if (Calendar.equipos.length === 0) {
      container.innerHTML = '<small class="text-muted">No hay equipos disponibles</small>';
      return;
    }

    // Calculate usage for this slot (excluding current reservation)
    const maxUsage = {};
    Calendar.equipos.forEach(eq => {
      let used = 0;
      Calendar.allReservations.forEach(r => {
        if (r.Fecha === reserva.Fecha && r.BloqueID === reserva.BloqueID && r.ID !== reserva.ID && r.Equipos) {
          if (r.Equipos.split(',').map(x => x.trim()).includes(String(eq.ID))) {
            used++;
          }
        }
      });
      maxUsage[eq.ID] = used;
    });

    container.innerHTML = Calendar.equipos.map(eq => {
      const isSelected = selectedIds.includes(String(eq.ID));
      const available = eq.Cantidad - maxUsage[eq.ID];
      const canSelect = available > 0 || isSelected;
      const availClass = available <= 0 && !isSelected ? 'text-danger' : 'text-muted';
      return `<div class="form-check">
        <input class="form-check-input" type="checkbox" value="${eq.ID}" id="edit-eq-${eq.ID}" ${isSelected ? 'checked' : ''} ${!canSelect ? 'disabled' : ''}>
        <label class="form-check-label" for="edit-eq-${eq.ID}">
          ${eq.Nombre} <small class="${availClass}">(${eq.Descripcion || ''} — ${available} de ${eq.Cantidad} disponibles)</small>
        </label>
      </div>`;
    }).join('');
  },

  async saveEditReservation() {
    const btn = document.getElementById('btn-edit-confirm');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    const equipos = [];
    document.querySelectorAll('#edit-res-equipos-container input[type="checkbox"]:checked').forEach(cb => {
      equipos.push(Number(cb.value));
    });

    try {
      const res = await Api.updateReservation({
        reservaId: this._editReserva.ID,
        actividad: document.getElementById('edit-res-actividad').value.trim(),
        responsable: document.getElementById('edit-res-responsable').value.trim(),
        comentarios: document.getElementById('edit-res-comentarios').value.trim(),
        equipos
      });

      if (res.ok) {
        this.showToast('Reserva actualizada', 'success');
        this._modalEditar.hide();
        Calendar.invalidateCache();
        Calendar.loadAndRender();
      } else {
        this.showToast(res.error || 'Error al actualizar', 'error');
      }
    } catch (e) {
      this.showToast('Error de conexión', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar Cambios';
    }
  },

  deleteFromEdit() {
    if (!confirm('¿Cancelar esta reserva?')) return;
    this._modalEditar.hide();
    this.cancelSingle(this._editReserva.ID);
  },

  // ── Equipment Checkboxes ────────────────────────────

  populateEquipmentCheckboxes() {
    const container = document.getElementById('res-equipos-container');
    if (Calendar.equipos.length === 0) {
      container.innerHTML = '<small class="text-muted">No hay equipos disponibles</small>';
      return;
    }

    // Calculate equipment usage for selected slots
    const slots = this._reservationSelections || [];
    const eqUsage = {};
    Calendar.equipos.forEach(eq => { eqUsage[eq.ID] = 0; });

    slots.forEach(s => {
      Calendar.allReservations.forEach(r => {
        if (r.Fecha === s.fecha && r.BloqueID === s.bloqueId && r.Equipos) {
          r.Equipos.split(',').forEach(id => {
            const eqId = id.trim();
            if (eqId && eqUsage[Number(eqId)] !== undefined) {
              eqUsage[Number(eqId)]++;
            }
          });
        }
      });
    });

    // Get max usage across all selected slots for each equipment
    const maxUsage = {};
    Calendar.equipos.forEach(eq => { maxUsage[eq.ID] = 0; });
    slots.forEach(s => {
      Calendar.equipos.forEach(eq => {
        let used = 0;
        Calendar.allReservations.forEach(r => {
          if (r.Fecha === s.fecha && r.BloqueID === s.bloqueId && r.Equipos) {
            if (r.Equipos.split(',').map(x => x.trim()).includes(String(eq.ID))) {
              used++;
            }
          }
        });
        if (used > maxUsage[eq.ID]) maxUsage[eq.ID] = used;
      });
    });

    container.innerHTML = Calendar.equipos.map(eq => {
      const available = eq.Cantidad - maxUsage[eq.ID];
      const availClass = available <= 0 ? 'text-danger' : 'text-muted';
      return `<div class="form-check">
        <input class="form-check-input" type="checkbox" value="${eq.ID}" id="eq-${eq.ID}" ${available <= 0 ? 'disabled' : ''}>
        <label class="form-check-label" for="eq-${eq.ID}">
          ${eq.Nombre} <small class="${availClass}">(${eq.Descripcion || ''} — ${available} de ${eq.Cantidad} disponibles)</small>
        </label>
      </div>`;
    }).join('');
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

    const h = ['<div class="sala-grid summary-grid">'];

    Calendar.salas.forEach(sala => {
      const salaReservas = reservas
        .filter(r => r.SalaID === sala.ID)
        .sort((a, b) => a.BloqueID - b.BloqueID);

      h.push('<div class="sala-panel">');
      h.push(`<div class="sala-panel-header"><span class="sala-panel-name">${sala.Nombre}</span><span class="sala-panel-cap">Cap. ${sala.Capacidad}</span></div>`);

      if (salaReservas.length === 0) {
        h.push('<div class="p-3 text-center text-muted" style="font-size:0.8125rem">Sin reservas</div>');
      } else {
        h.push('<table class="summary-table">');
        h.push('<thead><tr><th>Bloque</th><th>Actividad</th><th>Responsable</th><th>Comentarios</th><th>Equipos</th></tr></thead>');
        h.push('<tbody>');

        salaReservas.forEach(r => {
          const bloque = Calendar.bloques.find(b => b.ID === r.BloqueID);
          const eqNames = r.Equipos ? r.Equipos.split(',').map(id => {
            const eq = Calendar.equipos.find(e => String(e.ID) === id.trim());
            return eq ? eq.Nombre : '';
          }).filter(Boolean).join(', ') : '';

          h.push(`<tr>
            <td><strong>${bloque ? bloque.Etiqueta : ''}</strong></td>
            <td>${r.Actividad || ''}</td>
            <td>${r.Responsable || r.Nombre}</td>
            <td>${r.Comentarios || ''}</td>
            <td>${eqNames}</td>
          </tr>`);
        });

        h.push('</tbody></table>');
      }

      h.push('</div>');
    });

    h.push('</div>');

    // Totales de equipos del día
    const eqTotals = {};
    reservas.forEach(r => {
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

    const eqKeys = Object.keys(eqTotals);
    if (eqKeys.length > 0) {
      const eqText = eqKeys.map(k => eqTotals[k] + ' ' + k).join(', ');
      h.push(`<div class="summary-equipment-totals mt-3">Total equipos del d\u00eda: ${eqText}</div>`);
    }

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
