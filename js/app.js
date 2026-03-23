/* ============================================
   App Principal - Autenticación, Navegación y Reservas
   Sistema de Reserva de Salas SJO (Azure)
   ============================================ */

const App = {
  currentUser: null,
  _modalReservar: null,
  _modalCancelar: null,

  async init() {
    this.bindEvents();

    // Try auto-login via SWA auth
    await this.tryAutoLogin();
  },

  bindEvents() {
    // Navbar navigation
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.showView(el.dataset.nav);
      });
    });

    document.getElementById('btn-login').addEventListener('click', () => Auth.login());
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());

    // Simple button clicks
    const click = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    click('btn-config', () => this.showView('configuracion'));
    click('btn-clear-sel', () => Calendar.clearSelection());
    click('btn-reserve-sel', () => Calendar.openSelectionReservation());
    click('btn-clear-cancel-sel', () => Calendar.clearCancelSelection());
    click('btn-bulk-cancel', () => this.openBulkCancel());
    click('btn-summary-prev', () => this.shiftSummaryDate(-1));
    click('btn-summary-next', () => this.shiftSummaryDate(1));
    click('btn-res-confirm', () => this.confirmReservation());
    click('btn-cancel-confirm', () => this.confirmCancel());
    click('btn-edit-delete', () => this.deleteFromEdit());
    click('btn-edit-confirm', () => this.saveEditReservation());
    click('btn-import-all', () => this._importToggleAll(true));
    click('btn-import-none', () => this._importToggleAll(false));
    click('btn-import-confirm', () => this._importConfirm());
    click('btn-import-xlsx', () => document.getElementById('xlsx-import-input').click());
    click('btn-delete-nonadmin', () => this.deleteNonAdminUsers());

    // Inputs
    document.getElementById('xlsx-import-input')?.addEventListener('change', e => this.importUsuariosFile(e.target));
    document.getElementById('res-recurrence-check')?.addEventListener('change', () => this.toggleResRecurrence());

    // Config tabs — delegation on #config-tabs
    document.getElementById('config-tabs')?.addEventListener('click', e => {
      const link = e.target.closest('[data-tab]');
      if (link) { e.preventDefault(); this.showConfigTab(link.dataset.tab, e); }
    });

    // "+ Agregar" buttons — delegation on #view-configuracion
    document.getElementById('view-configuracion')?.addEventListener('click', e => {
      const addBtn = e.target.closest('[data-add]');
      if (addBtn) this.addConfigRow(addBtn.dataset.add);
    });

    // Config table rows — delegation for edit/delete/save/cancel
    ['equipos', 'bloques', 'salas', 'usuarios'].forEach(tab => {
      document.getElementById('config-' + tab + '-list')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const tr = btn.closest('tr');
        const id = tr?.dataset.id;
        if (action === 'editConfig') this.editConfig(this._configTab, this._configTab === 'usuarios' ? id : Number(id));
        else if (action === 'deleteConfig') this.deleteConfig(this._configTab, this._configTab === 'usuarios' ? id : Number(id));
        else if (action === 'saveConfig') this.saveConfig(this._configTab, this._configTab === 'usuarios' ? id : (id ? Number(id) : null));
        else if (action === 'cancelEditRow') this.cancelEditRow(this._configTab);
      });
    });

    // My Reservations — delegation for cancel buttons
    document.getElementById('my-reservations-list')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'cancelGroup') this.cancelRecurrenceGroup(btn.dataset.group);
      else if (btn.dataset.action === 'cancelSingle') this.cancelSingle(Number(btn.dataset.resId), btn.dataset.fecha);
    });
  },

  // ── Helpers ───────────────────────────────────────

  get userRole() {
    return (this.currentUser?.Rol || 'user').toLowerCase();
  },

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
      console.error('tryAutoLogin error:', e);
      const btn = document.getElementById('btn-login');
      btn.disabled = false;
      btn.textContent = 'Ingresar con cuenta UCSC';
      document.getElementById('login-error').textContent = 'Error: ' + (e.message || e);
      document.getElementById('login-error').classList.remove('d-none');
    }
  },

  showApp() {
    const rol = this.userRole;

    document.getElementById('login-screen').classList.add('d-none');
    document.getElementById('app-container').classList.remove('d-none');
    document.getElementById('user-display').textContent = this.currentUser.Nombre + ' [' + (this.currentUser.Rol || 'user') + ']';
    console.log('showApp currentUser:', JSON.stringify(this.currentUser));

    if (rol === 'viewer') {
      // Hide "Mis Reservas" tab
      const misReservasLi = document.getElementById('nav-li-mis-reservas');
      if (misReservasLi) misReservasLi.style.display = 'none';
      // Hide config button
      document.getElementById('btn-config').style.display = 'none';
      // Hide selection bars and legend-hint
      document.getElementById('selection-bar').style.display = 'none';
      document.getElementById('cancel-selection-bar').style.display = 'none';
      const hint = document.querySelector('.legend-hint');
      if (hint) hint.style.display = 'none';
    } else {
      // Cache modal instances (viewer doesn't need them)
      this._modalReservar = new bootstrap.Modal(document.getElementById('reservationModal'));
      this._modalCancelar = new bootstrap.Modal(document.getElementById('cancelModal'));
    }

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
    const rol = this.userRole;

    // Guards for viewer
    if (rol === 'viewer' && (name === 'mis-reservas' || name === 'configuracion')) {
      name = 'calendario';
    }

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('d-none'));
    document.getElementById('view-' + name).classList.remove('d-none');
    document.querySelectorAll('[data-nav]').forEach(l => l.classList.remove('active'));
    document.querySelector(`[data-nav="${name}"]`)?.classList.add('active');

    if (name === 'mis-reservas') this.loadMyReservations();
    if (name === 'resumen-diario') this.loadDailySummary();
    if (name === 'configuracion') {
      this._setupConfigTabs();
    }
  },

  _setupConfigTabs() {
    const rol = this.userRole;
    console.log('_setupConfigTabs rol:', rol, 'currentUser.Rol:', this.currentUser?.Rol);
    const allTabs = ['equipos', 'bloques', 'salas', 'usuarios'];
    const visibleTabs = rol === 'admin' ? allTabs : (rol === 'user' ? ['equipos'] : []);

    allTabs.forEach(tab => {
      const li = document.getElementById('config-tab-li-' + tab);
      if (li) li.style.display = visibleTabs.includes(tab) ? '' : 'none';
    });

    // Load first visible tab
    const firstTab = visibleTabs[0] || 'equipos';
    this.showConfigTab(firstTab);
  },

  // ── Modal de Reserva ──────────────────────────────────

  openMultiReservation(selections) {
    this._reservationSelections = selections;

    // Remove any previous conflict detail
    const conflictEl = document.getElementById('res-conflict-detail');
    if (conflictEl) conflictEl.remove();

    // Summary
    const groups = {};
    selections.forEach(s => {
      const key = `${s.salaId}|${s.fecha}`;
      if (!groups[key]) groups[key] = { salaName: s.salaName, fecha: s.fecha, bloques: [] };
      groups[key].bloques.push(s.bloqueLabel);
    });

    let infoHtml = Object.values(groups).map(g =>
      `<strong>${escapeHtml(g.salaName)}</strong> — ${escapeHtml(g.fecha)} — ${g.bloques.map(b => escapeHtml(b)).join(', ')}`
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
    const earliest = selections.map(s => s.fecha).sort()[0];
    document.getElementById('res-recurrence-from').value = earliest;
    const until = new Date(earliest + 'T12:00:00');
    until.setDate(until.getDate() + 28);
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
    if (actividad.length > 200) { this.showToast('Actividad: máximo 200 caracteres', 'warning'); return; }

    const responsable = document.getElementById('res-responsable').value.trim() || this.currentUser.Nombre;
    if (responsable.length > 100) { this.showToast('Responsable: máximo 100 caracteres', 'warning'); return; }

    let allSlots = this._reservationSelections.map(s => ({
      salaId: s.salaId, fecha: s.fecha, bloqueId: s.bloqueId
    }));

    let recurrenciaGrupo = '';
    const isRecurrent = document.getElementById('res-recurrence-check').checked;
    if (isRecurrent) {
      const from = document.getElementById('res-recurrence-from').value;
      const until = document.getElementById('res-recurrence-until').value;
      if (!from) { this.showToast('Selecciona fecha de inicio', 'warning'); return; }
      if (!until) { this.showToast('Selecciona fecha límite', 'warning'); return; }
      recurrenciaGrupo = 'REC-' + Date.now();
      const fromDate = new Date(from + 'T00:00:00');
      const untilDate = new Date(until + 'T00:00:00');

      for (const s of this._reservationSelections) {
        const baseDate = new Date(s.fecha + 'T00:00:00');
        const dayOfWeek = baseDate.getDay();

        // Find first occurrence on this weekday >= fromDate
        let cursor = new Date(fromDate);
        const cursorDay = cursor.getDay();
        let diff = dayOfWeek - cursorDay;
        if (diff < 0) diff += 7;
        cursor.setDate(cursor.getDate() + diff);

        while (cursor <= untilDate) {
          const dateStr = Calendar.formatDate(cursor);
          // Skip the originally selected date (already in allSlots)
          if (dateStr !== s.fecha) {
            allSlots.push({ salaId: s.salaId, fecha: dateStr, bloqueId: s.bloqueId });
          }
          cursor.setDate(cursor.getDate() + 7);
        }
      }
    }

    const btn = document.getElementById('btn-res-confirm');
    btn.disabled = true;
    btn.textContent = 'Verificando disponibilidad...';

    // Determine all years covered by the slots (recurrence may span year boundary)
    const slotYears = [...new Set(allSlots.map(s => Number(s.fecha.substring(0, 4))))];

    // Pre-check: reload fresh data for all needed years
    const reloadOk = await Calendar.reloadData(true, slotYears);
    if (!reloadOk) {
      this.showToast('No se pudo verificar disponibilidad. Revisa tu conexión e intenta de nuevo.', 'error');
      btn.disabled = false;
      btn.textContent = 'Confirmar Reserva';
      return;
    }

    const conflicts = [];
    for (const s of allSlots) {
      const existing = Calendar.getRes(s.salaId, s.fecha, s.bloqueId);
      if (existing) {
        const sala = Calendar.salas.find(l => l.ID === s.salaId);
        const bloque = Calendar.bloques.find(b => b.ID === s.bloqueId);
        conflicts.push({
          sala: sala?.Nombre || 'Sala ' + s.salaId,
          fecha: s.fecha,
          bloque: bloque?.Etiqueta || 'Bloque ' + s.bloqueId,
          actividad: existing.Actividad,
          responsable: existing.Responsable || existing.Nombre
        });
      }
    }

    if (conflicts.length > 0) {
      const detail = conflicts.map(c =>
        `<li><strong>${escapeHtml(c.sala)}</strong> — ${escapeHtml(c.fecha)} — ${escapeHtml(c.bloque)}<br>` +
        `<small class="text-muted">${escapeHtml(c.actividad)} (${escapeHtml(c.responsable)})</small></li>`
      ).join('');
      let alertEl = document.getElementById('res-conflict-detail');
      if (!alertEl) {
        alertEl = document.createElement('div');
        alertEl.id = 'res-conflict-detail';
        document.querySelector('#reservationModal .modal-body').prepend(alertEl);
      }
      alertEl.className = 'alert alert-danger';
      alertEl.innerHTML = `<strong>Slots no disponibles:</strong><ul class="mb-0 mt-1">${detail}</ul>`;
      btn.disabled = false;
      btn.textContent = 'Confirmar Reserva';
      return;
    }

    btn.textContent = 'Reservando...';

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
        await Calendar.reloadData(true);
        Calendar.render();
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
      h.push(`<li><strong>${escapeHtml(s.salaName)}</strong> — ${escapeHtml(s.fecha)} — ${escapeHtml(s.bloqueLabel)}</li>`);
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
      const results = await Promise.all(
        this._cancelItems.map(s => Api.cancelReservation(s.reservaId, s.fecha))
      );
      const errors = results.filter(r => !r.ok).map(r => r.error);

      if (errors.length === 0) {
        this.showToast(`${this._cancelItems.length} reserva(s) cancelada(s)`, 'success');
      } else {
        this.showToast(`Errores: ${errors.join(', ')}`, 'error');
      }

      this._modalCancelar.hide();
      Calendar.clearCancelSelection();
      await Calendar.reloadData(true);
      Calendar.render();
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
              <h6 class="mt-1 mb-0">${escapeHtml(sala?.Nombre || 'Sala')} — ${escapeHtml(reservas[0].Actividad)}</h6>
            </div>
            <button class="btn btn-outline-danger btn-sm" data-action="cancelGroup" data-group="${escapeHtml(groupId)}">Cancelar grupo</button>
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
            <strong>${escapeHtml(sala?.Nombre || 'Sala')}</strong> — ${escapeHtml(r.Fecha)} — ${escapeHtml(bl?.Etiqueta || '')}
            <br><small class="text-muted">${escapeHtml(r.Actividad)}</small>
          </div>
          <button class="btn btn-outline-danger btn-sm" data-action="cancelSingle" data-res-id="${r.ID}" data-fecha="${r.Fecha}">Cancelar</button>
        </div>
      </div>`);
    });

    container.innerHTML = h.join('');
  },

  async cancelSingle(id, fecha) {
    if (!confirm('¿Cancelar esta reserva?')) return;
    try {
      const res = await Api.cancelReservation(id, fecha);
      if (res.ok) {
        this.showToast('Reserva cancelada', 'success');
        await Calendar.reloadData(true);
        Calendar.render();
        this.loadMyReservations();
      } else {
        this.showToast(res.error || 'Error al cancelar', 'error');
      }
    } catch (e) {
      this.showToast('Error de conexión al cancelar', 'error');
    }
  },

  async cancelRecurrenceGroup(groupId) {
    if (!confirm('¿Cancelar TODAS las reservas de este grupo recurrente?')) return;
    const res = await Api.cancelRecurrenceGroup(groupId);
    if (res.ok) {
      this.showToast(`${res.data.canceladas} reservas canceladas`, 'success');
      await Calendar.reloadData(true);
      Calendar.render();
      this.loadMyReservations();
    } else {
      this.showToast(res.error || 'Error', 'error');
    }
  },

  // ── Editar Reserva ──────────────────────────────────

  openEditReservation(reserva) {
    this._editReserva = reserva;

    const sala = Calendar.salas.find(s => s.ID === reserva.SalaID);
    const bloque = Calendar.bloques.find(b => b.ID === reserva.BloqueID);

    let infoHtml = `<strong>${escapeHtml(sala?.Nombre || 'Sala')}</strong> — ${escapeHtml(reserva.Fecha)} — ${escapeHtml(bloque?.Etiqueta || '')}<br>
       <small class="text-muted">Reservado por: ${escapeHtml(reserva.Nombre)}</small>`;

    // Show recurrence badge if part of a group
    if (reserva.Recurrencia) {
      const groupCount = Calendar.allReservations.filter(r => r.Recurrencia === reserva.Recurrencia).length;
      infoHtml += `<br><span class="badge bg-primary mt-1">Recurrente (${groupCount} bloques)</span>`;
    }

    document.getElementById('edit-res-info').innerHTML = infoHtml;
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
    const selectedIds = parseEquipos(currentEquipos);
    const reserva = this._editReserva;

    if (Calendar.equipos.length === 0) {
      container.innerHTML = '<small class="text-muted">No hay equipos disponibles</small>';
      return;
    }

    const maxUsage = calcEquipUsageForSlots(
      [{ Fecha: reserva.Fecha, BloqueID: reserva.BloqueID }],
      Calendar.allReservations, Calendar.equipos, reserva.ID
    );

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
    const actividad = document.getElementById('edit-res-actividad').value.trim();
    if (actividad.length > 200) { this.showToast('Actividad: máximo 200 caracteres', 'warning'); return; }
    const responsable = document.getElementById('edit-res-responsable').value.trim();
    if (responsable.length > 100) { this.showToast('Responsable: máximo 100 caracteres', 'warning'); return; }

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
        fecha: this._editReserva.Fecha,
        actividad,
        responsable,
        comentarios: document.getElementById('edit-res-comentarios').value.trim(),
        equipos
      });

      if (res.ok) {
        this.showToast('Reserva actualizada', 'success');
        this._modalEditar.hide();
        await Calendar.reloadData(true);
        Calendar.render();
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
    const reserva = this._editReserva;
    if (!reserva) return;

    if (reserva.Recurrencia) {
      const groupCount = Calendar.allReservations.filter(r => r.Recurrencia === reserva.Recurrencia).length;
      const choice = prompt(
        `Esta reserva es parte de un grupo recurrente (${groupCount} bloques).\n\n` +
        'Escribe "todas" para cancelar TODAS las del grupo,\n' +
        'o "esta" para cancelar solo esta reserva:',
        'esta'
      );
      if (!choice) return;
      const normalized = choice.trim().toLowerCase();
      if (normalized === 'todas') {
        this._modalEditar.hide();
        this.cancelRecurrenceGroup(reserva.Recurrencia);
      } else if (normalized === 'esta') {
        this._modalEditar.hide();
        this.cancelSingle(reserva.ID, reserva.Fecha);
      }
    } else {
      if (!confirm('¿Cancelar esta reserva?')) return;
      this._modalEditar.hide();
      this.cancelSingle(reserva.ID, reserva.Fecha);
    }
  },

  // ── Equipment Checkboxes ────────────────────────────

  populateEquipmentCheckboxes() {
    const container = document.getElementById('res-equipos-container');
    if (Calendar.equipos.length === 0) {
      container.innerHTML = '<small class="text-muted">No hay equipos disponibles</small>';
      return;
    }

    const slots = this._reservationSelections || [];
    const maxUsage = calcEquipUsageForSlots(slots, Calendar.allReservations, Calendar.equipos);

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

  shiftSummaryDate(delta) {
    const picker = document.getElementById('summary-date-picker');
    const d = new Date(picker.value + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    picker.value = Calendar.formatDate(d);
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
          const eqNames = r.Equipos ? parseEquipos(r.Equipos).map(id => {
            const eq = Calendar.equipos.find(e => String(e.ID) === id);
            return eq ? eq.Nombre : '';
          }).filter(Boolean).join(', ') : '';

          h.push(`<tr>
            <td><strong>${escapeHtml(bloque ? bloque.Etiqueta : '')}</strong></td>
            <td>${escapeHtml(r.Actividad || '')}</td>
            <td>${escapeHtml(r.Responsable || r.Nombre)}</td>
            <td>${escapeHtml(r.Comentarios || '')}</td>
            <td>${escapeHtml(eqNames)}</td>
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
        parseEquipos(r.Equipos).forEach(id => {
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
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto"></button></div>`;
    el.querySelector('.btn-close').addEventListener('click', () => el.remove());

    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  // ── Configuración ────────────────────────────────────

  _configTab: 'equipos',

  showConfigTab(tab, event) {
    if (event) event.preventDefault();
    document.querySelectorAll('#config-tabs .nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.config-tab').forEach(t => t.classList.add('d-none'));
    document.querySelector(`#config-tabs .nav-link[data-tab="${tab}"]`)?.classList.add('active');
    document.getElementById('config-tab-' + tab)?.classList.remove('d-none');
    this._configTab = tab;
    this.loadConfigTab(tab);
  },

  _renderReadRow(tab, item) {
    const esc = s => escapeHtml(s);

    if (tab === 'usuarios') {
      const btns = `<td>
        <button class="btn btn-outline-primary btn-sm py-0 px-1" data-action="editConfig">Editar</button>
        <button class="btn btn-outline-danger btn-sm py-0 px-1" data-action="deleteConfig">Eliminar</button></td>`;
      return `<tr data-id="${esc(item.Email)}"><td>${esc(item.Email)}</td><td>${esc(item.Nombre)}</td><td>${esc(item.Rol)}</td>${btns}</tr>`;
    }

    const btns = `<td>
      <button class="btn btn-outline-primary btn-sm py-0 px-1" data-action="editConfig">Editar</button>
      <button class="btn btn-outline-danger btn-sm py-0 px-1" data-action="deleteConfig">Eliminar</button></td>`;
    if (tab === 'equipos') {
      return `<tr data-id="${item.ID}"><td>${item.ID}</td><td>${esc(item.Nombre)}</td><td>${esc(item.Descripcion || '')}</td><td>${item.Cantidad}</td>${btns}</tr>`;
    } else if (tab === 'bloques') {
      return `<tr data-id="${item.ID}"><td>${item.ID}</td><td>${esc(item.HoraInicio)}</td><td>${esc(item.HoraFin)}</td><td>${esc(item.Etiqueta || '')}</td>${btns}</tr>`;
    } else if (tab === 'salas') {
      return `<tr data-id="${item.ID}"><td>${item.ID}</td><td>${esc(item.Nombre)}</td><td>${item.Capacidad}</td>${btns}</tr>`;
    }
  },

  _renderEditRow(tab, item) {
    const esc = s => escapeHtml(s);

    if (tab === 'usuarios') {
      const email = item ? item.Email : '';
      const isEdit = !!item;
      const btns = `<td>
        <button class="btn btn-success btn-sm py-0 px-1" data-action="saveConfig">Guardar</button>
        <button class="btn btn-secondary btn-sm py-0 px-1" data-action="cancelEditRow">Cancelar</button></td>`;
      const rolOptions = ['admin', 'user', 'viewer'].map(r =>
        `<option value="${r}" ${(item?.Rol || 'user') === r ? 'selected' : ''}>${r}</option>`
      ).join('');
      return `<tr class="cfg-editing" data-id="${esc(email)}">
        <td><input type="email" class="form-control form-control-sm" data-field="Email" value="${esc(email)}" ${isEdit ? 'readonly' : ''} placeholder="email@ucsc.cl"></td>
        <td><input type="text" class="form-control form-control-sm" data-field="Nombre" value="${esc(item?.Nombre || '')}"></td>
        <td><select class="form-select form-select-sm" data-field="Rol">${rolOptions}</select></td>
        ${btns}</tr>`;
    }

    const id = item ? item.ID : '';
    const btns = `<td>
      <button class="btn btn-success btn-sm py-0 px-1" data-action="saveConfig">Guardar</button>
      <button class="btn btn-secondary btn-sm py-0 px-1" data-action="cancelEditRow">Cancelar</button></td>`;
    if (tab === 'equipos') {
      return `<tr class="cfg-editing" data-id="${id}">
        <td>${id || '<small class="text-muted">Nuevo</small>'}</td>
        <td><input type="text" class="form-control form-control-sm" data-field="Nombre" value="${esc(item?.Nombre || '')}"></td>
        <td><input type="text" class="form-control form-control-sm" data-field="Descripcion" value="${esc(item?.Descripcion || '')}"></td>
        <td><input type="number" class="form-control form-control-sm" data-field="Cantidad" value="${item?.Cantidad ?? 1}" min="1"></td>
        ${btns}</tr>`;
    } else if (tab === 'bloques') {
      return `<tr class="cfg-editing" data-id="${id}">
        <td>${id || '<small class="text-muted">Nuevo</small>'}</td>
        <td><input type="time" class="form-control form-control-sm" data-field="HoraInicio" value="${esc(item?.HoraInicio || '')}"></td>
        <td><input type="time" class="form-control form-control-sm" data-field="HoraFin" value="${esc(item?.HoraFin || '')}"></td>
        <td><input type="text" class="form-control form-control-sm" data-field="Etiqueta" value="${esc(item?.Etiqueta || '')}" placeholder="Ej: 08:00 - 09:00"></td>
        ${btns}</tr>`;
    } else if (tab === 'salas') {
      return `<tr class="cfg-editing" data-id="${id}">
        <td>${id || '<small class="text-muted">Nuevo</small>'}</td>
        <td><input type="text" class="form-control form-control-sm" data-field="Nombre" value="${esc(item?.Nombre || '')}"></td>
        <td><input type="number" class="form-control form-control-sm" data-field="Capacidad" value="${item?.Capacidad ?? 0}" min="0"></td>
        ${btns}</tr>`;
    }
  },

  async loadConfigTab(tab) {
    let items;
    if (tab === 'usuarios') {
      // Always fetch from API (no Calendar cache for users)
      const res = await Api.configManager(tab, 'list');
      if (!res.ok) { this.showToast(res.error || 'Error cargando usuarios', 'error'); return; }
      items = res.data;
    } else if (tab === 'equipos' && Calendar.equipos?.length) {
      items = Calendar.equipos;
    } else if (tab === 'bloques' && Calendar.bloques?.length) {
      items = Calendar.bloques;
    } else if (tab === 'salas' && Calendar.salas?.length) {
      items = Calendar.salas;
    } else {
      const res = await Api.configManager(tab, 'list');
      if (!res.ok) { this.showToast(res.error || 'Error cargando datos', 'error'); return; }
      items = res.data;
    }

    const tbody = document.getElementById('config-' + tab + '-list');
    const colSpans = { equipos: 5, bloques: 5, salas: 4, usuarios: 4 };
    const colSpan = colSpans[tab] || 5;
    const emptyLabels = { equipos: 'Sin equipos', bloques: 'Sin bloques', salas: 'Sin salas', usuarios: 'Sin usuarios' };

    tbody.innerHTML = items.map(item => this._renderReadRow(tab, item)).join('')
      || `<tr><td colspan="${colSpan}" class="text-muted text-center">${emptyLabels[tab]}</td></tr>`;
    this._configData = items;
  },

  addConfigRow(tab) {
    const tbody = document.getElementById('config-' + tab + '-list');
    // Remove any existing editing row first
    const existing = tbody.querySelector('tr.cfg-editing');
    if (existing) { this.cancelEditRow(tab); return; }
    tbody.insertAdjacentHTML('beforeend', this._renderEditRow(tab, null));
    tbody.querySelector('tr.cfg-editing input')?.focus();
  },

  editConfig(tab, id) {
    let item;
    if (tab === 'usuarios') {
      item = (this._configData || []).find(i => i.Email === id);
    } else {
      item = (this._configData || []).find(i => i.ID === id);
    }
    if (!item) return;
    const tbody = document.getElementById('config-' + tab + '-list');
    // Cancel any other editing row
    const existing = tbody.querySelector('tr.cfg-editing');
    if (existing) existing.remove();
    // Replace the target row with an edit row
    const selector = tab === 'usuarios' ? `tr[data-id="${item.Email}"]` : `tr[data-id="${id}"]`;
    const row = tbody.querySelector(selector);
    if (row) {
      row.outerHTML = this._renderEditRow(tab, item);
      tbody.querySelector('tr.cfg-editing input')?.focus();
    }
  },

  cancelEditRow(tab) {
    this.loadConfigTab(tab);
  },

  async saveConfig(tab, rowId) {
    const tbody = document.getElementById('config-' + tab + '-list');
    const editRow = tbody.querySelector('tr.cfg-editing');
    if (!editRow) return;

    const val = field => {
      const input = editRow.querySelector(`input[data-field="${field}"], select[data-field="${field}"]`);
      return (input?.value || '').trim();
    };

    let data = {};

    if (tab === 'usuarios') {
      data = {
        Email: val('Email'),
        Nombre: val('Nombre'),
        Rol: val('Rol') || 'user'
      };
      if (!data.Email) { this.showToast('Ingresa el email', 'warning'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.Email)) { this.showToast('Email no válido', 'warning'); return; }
      if (!data.Nombre) { this.showToast('Ingresa el nombre', 'warning'); return; }
    } else if (tab === 'equipos') {
      data = {
        ID: rowId || null,
        Nombre: val('Nombre'),
        Descripcion: val('Descripcion'),
        Cantidad: Number(val('Cantidad')) || 1
      };
      if (!data.Nombre) { this.showToast('Ingresa el nombre', 'warning'); return; }
    } else if (tab === 'bloques') {
      data = {
        ID: rowId || null,
        HoraInicio: val('HoraInicio'),
        HoraFin: val('HoraFin'),
        Etiqueta: val('Etiqueta')
      };
      if (!data.HoraInicio || !data.HoraFin) { this.showToast('Ingresa horas de inicio y fin', 'warning'); return; }
      if (!data.Etiqueta) data.Etiqueta = data.HoraInicio + ' - ' + data.HoraFin;
    } else if (tab === 'salas') {
      data = {
        ID: rowId || null,
        Nombre: val('Nombre'),
        Capacidad: Number(val('Capacidad')) || 0
      };
      if (!data.Nombre) { this.showToast('Ingresa el nombre', 'warning'); return; }
    }

    try {
      const res = await Api.configManager(tab, 'save', data);
      if (res.ok) {
        this.showToast('Guardado', 'success');
        if (res.warning) this.showToast(res.warning, 'warning');
        if (tab === 'usuarios') {
          this.loadConfigTab(tab);
        } else {
          await this._reloadConfigAndCalendar(tab);
        }
      } else {
        this.showToast(res.error || 'Error al guardar', 'error');
      }
    } catch (e) {
      console.error('saveConfig error:', e);
      this.showToast('Error: ' + (e.message || e), 'error');
    }
  },

  async importUsuariosFile(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length === 0) { this.showToast('El archivo está vacío', 'warning'); return; }

      const first = rows[0];
      const keys = Object.keys(first);
      const findCol = (...names) => keys.find(k => names.includes(k.toLowerCase()));
      const colNombre = findCol('nombre', 'name', 'nombres');
      const colEmail = findCol('email', 'correo', 'mail', 'e-mail');

      if (!colNombre || !colEmail) { this.showToast('El archivo debe tener columnas "Nombre" y "Email"', 'error'); return; }

      this._importPending = rows
        .map(r => ({ Nombre: String(r[colNombre]).trim(), Email: String(r[colEmail]).trim().toLowerCase() }))
        .filter(u => u.Nombre && u.Email);

      if (this._importPending.length === 0) { this.showToast('No se encontraron usuarios válidos', 'warning'); return; }

      // Render checkboxes in modal
      const container = document.getElementById('import-usuarios-list');
      container.innerHTML = this._importPending.map((u, i) =>
        `<div class="form-check">
          <input class="form-check-input import-user-check" type="checkbox" id="imp-${i}" value="${i}" checked>
          <label class="form-check-label" for="imp-${i}" style="font-size:0.8125rem">
            <strong>${escapeHtml(u.Nombre)}</strong> <span class="text-muted">— ${escapeHtml(u.Email)}</span>
          </label>
        </div>`
      ).join('');
      this._importUpdateCount();

      if (!this._modalImportar) {
        this._modalImportar = new bootstrap.Modal(document.getElementById('importUsuariosModal'));
      }
      this._modalImportar.show();
    } catch (e) {
      console.error('Import error:', e);
      this.showToast('Error al leer el archivo: ' + e.message, 'error');
    }
  },

  _importToggleAll(checked) {
    document.querySelectorAll('.import-user-check').forEach(cb => cb.checked = checked);
    this._importUpdateCount();
  },

  _importUpdateCount() {
    const total = document.querySelectorAll('.import-user-check').length;
    const selected = document.querySelectorAll('.import-user-check:checked').length;
    document.getElementById('import-count').textContent = `${selected} de ${total} seleccionados`;
  },

  async _importConfirm() {
    const selected = [];
    document.querySelectorAll('.import-user-check:checked').forEach(cb => {
      selected.push(this._importPending[Number(cb.value)]);
    });

    if (selected.length === 0) { this.showToast('Selecciona al menos un usuario', 'warning'); return; }

    const btn = document.getElementById('btn-import-confirm');
    btn.disabled = true;
    btn.textContent = 'Importando...';

    let ok = 0, errors = 0;
    for (const u of selected) {
      try {
        const rol = document.getElementById('import-rol-select').value;
        const res = await Api.configManager('usuarios', 'save', { Email: u.Email, Nombre: u.Nombre, Rol: rol });
        if (res.ok) ok++; else errors++;
      } catch (e) { errors++; }
    }

    btn.disabled = false;
    btn.textContent = 'Importar seleccionados';
    this._modalImportar.hide();
    this.showToast(`Importados: ${ok}${errors > 0 ? ', errores: ' + errors : ''}`, ok > 0 ? 'success' : 'error');
    this.loadConfigTab('usuarios');
  },

  async deleteNonAdminUsers() {
    const res = await Api.configManager('usuarios', 'list');
    if (!res.ok) { this.showToast(res.error || 'Error cargando usuarios', 'error'); return; }
    const nonAdmin = res.data.filter(u => (u.Rol || 'user') !== 'admin');
    if (nonAdmin.length === 0) { this.showToast('No hay usuarios no-admin para borrar', 'warning'); return; }
    if (!confirm(`¿Borrar ${nonAdmin.length} usuario(s) no-admin?\n\n${nonAdmin.map(u => u.Nombre + ' — ' + u.Email).join('\n')}`)) return;

    let ok = 0, errors = 0;
    for (const u of nonAdmin) {
      try {
        const r = await Api.configManager('usuarios', 'delete', { Email: u.Email });
        if (r.ok) ok++; else errors++;
      } catch (e) { errors++; }
    }
    this.showToast(`Eliminados: ${ok}${errors > 0 ? ', errores: ' + errors : ''}`, ok > 0 ? 'success' : 'error');
    this.loadConfigTab('usuarios');
  },

  async deleteConfig(tab, id) {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      const data = tab === 'usuarios' ? { Email: id } : { ID: id };
      const res = await Api.configManager(tab, 'delete', data);
      if (res.ok) {
        this.showToast('Eliminado', 'success');
        if (res.warning) this.showToast(res.warning, 'warning');
        if (tab === 'usuarios') {
          this.loadConfigTab(tab);
        } else {
          await this._reloadConfigAndCalendar(tab);
        }
      } else {
        this.showToast(res.error || 'Error al eliminar', 'error');
      }
    } catch (e) {
      console.error('deleteConfig error:', e);
      this.showToast('Error de conexión al eliminar', 'error');
    }
  },

  async _reloadConfigAndCalendar(tab) {
    // Refresh Calendar data FIRST, then re-render config table
    const initRes = await Api.fullInit();
    if (initRes.ok) {
      Calendar.salas = initRes.data.salas;
      Calendar.bloques = initRes.data.bloques;
      Calendar.equipos = initRes.data.equipos || [];
      Calendar.buildSalaFilters();
      Calendar.render();
    }
    this.loadConfigTab(tab);
  }
};

// Init
document.addEventListener('DOMContentLoaded', () => App.init());
