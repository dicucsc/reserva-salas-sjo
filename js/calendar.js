/* ============================================
   Vista de Calendario / Grilla de Ocupación
   Sistema de Reserva de Salas SJO
   ============================================ */

const Calendar = {
  currentDate: new Date(),
  salas: [],
  bloques: [],
  reservations: [],
  allReservations: [],
  loadedYear: null,
  viewMode: 'day',
  refreshInterval: null,
  _resMap: new Map(),

  // Selección múltiple de celdas libres (para reservar)
  selection: [],
  lastClicked: null,

  // Selección múltiple de celdas propias (para cancelar)
  cancelSelection: [],

  formatDate(d) {
    if (d instanceof Date) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return String(d).substring(0, 10);
  },

  formatDisplayDate(d) {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  },

  formatMonthYear(d) {
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  },

  getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    date.setDate(date.getDate() - ((day + 6) % 7));
    return date;
  },

  // ── Init ────────────────────────────────────────────────

  async init() {
    const year = this.currentDate.getFullYear();

    const [initRes, compactRes] = await Promise.all([
      Api.fullInit(),
      Api.getYearCompact(year)
    ]);

    if (initRes.ok) {
      this.salas = initRes.data.salas;
      this.bloques = initRes.data.bloques;
    }

    if (compactRes.ok) {
      this.allReservations = this.expandCompact(compactRes.data);
      this.loadedYear = year;
    }

    this.buildResMap();
    this.setupNavigation();
    this.setupEventDelegation();
    this.filterReservationsForView();
    this.renderCurrentView();
    this.startAutoRefresh();
  },

  setupNavigation() {
    document.getElementById('btn-prev').onclick = () => this.navigate(-1);
    document.getElementById('btn-next').onclick = () => this.navigate(1);
    document.getElementById('btn-today').onclick = () => {
      this.currentDate = new Date();
      document.getElementById('date-picker').value = this.formatDate(this.currentDate);
      this.loadAndRender();
    };

    const picker = document.getElementById('date-picker');
    picker.value = this.formatDate(this.currentDate);
    picker.onchange = () => {
      const val = picker.value;
      if (val) {
        this.currentDate = new Date(val + 'T12:00:00');
        this.loadAndRender();
      }
    };

    document.getElementById('btn-view-day').onclick = () => this.setViewMode('day');
    document.getElementById('btn-view-week').onclick = () => this.setViewMode('week');
    document.getElementById('btn-view-month').onclick = () => this.setViewMode('month');
  },

  setupEventDelegation() {
    const container = document.getElementById('calendar-grid');
    container.addEventListener('click', e => {
      const freeCell = e.target.closest('[data-sala][data-fecha][data-bloque]:not([data-res-id])');
      if (freeCell) {
        const salaId = Number(freeCell.dataset.sala);
        const fecha = freeCell.dataset.fecha;
        const bloqueId = Number(freeCell.dataset.bloque);
        const blockIndex = Number(freeCell.dataset.idx);
        const sala = this.salas.find(s => s.ID === salaId);
        const bloque = this.bloques.find(b => b.ID === bloqueId);
        this.toggleCell(salaId, sala ? sala.Nombre : 'Sala ' + salaId, fecha, bloqueId, bloque ? bloque.Etiqueta : 'Bloque ' + bloqueId, blockIndex, e);
        return;
      }

      const mineCell = e.target.closest('[data-res-id]');
      if (mineCell) {
        const reservaId = Number(mineCell.dataset.resId);
        const salaId = Number(mineCell.dataset.sala);
        const fecha = mineCell.dataset.fecha;
        const bloqueId = Number(mineCell.dataset.bloque);
        const sala = this.salas.find(s => s.ID === salaId);
        const bloque = this.bloques.find(b => b.ID === bloqueId);
        this.toggleCancelCell(reservaId, salaId, sala ? sala.Nombre : 'Sala ' + salaId, fecha, bloqueId, bloque ? bloque.Etiqueta : 'Bloque ' + bloqueId);
        return;
      }

      const monthCell = e.target.closest('[data-goto-day]');
      if (monthCell) {
        this.goToDay(monthCell.dataset.gotoDay);
      }
    });

    container.addEventListener('change', e => {
      if (e.target.id === 'month-sala-filter') {
        this.renderMonthGrid();
      }
    });
  },

  setViewMode(mode) {
    this.viewMode = mode;
    document.querySelectorAll('.btn-view-mode').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btn-view-' + mode).classList.add('active');
    this.loadAndRender();
  },

  navigate(dir) {
    if (this.viewMode === 'day') {
      this.currentDate.setDate(this.currentDate.getDate() + dir);
    } else if (this.viewMode === 'week') {
      this.currentDate.setDate(this.currentDate.getDate() + (dir * 7));
    } else {
      this.currentDate.setMonth(this.currentDate.getMonth() + dir);
    }
    document.getElementById('date-picker').value = this.formatDate(this.currentDate);
    this.loadAndRender();
  },

  // ── Compact data expansion ─────────────────────────────

  expandCompact(c) {
    return c.r.map(([id, s, doy, b, ui, ai, gi]) => ({
      ID: id,
      SalaID: s,
      Fecha: this.doyToDate(c.y, doy),
      BloqueID: b,
      Email: c.u[ui][0],
      Nombre: c.u[ui][1],
      Actividad: c.a[ai],
      Recurrencia: gi < 0 ? '' : c.g[gi]
    }));
  },

  doyToDate(y, doy) {
    const d = new Date(y, 0, doy);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // ── Reservation Map (O(1) lookup) ──────────────────────

  buildResMap() {
    this._resMap = new Map();
    this.allReservations.forEach(r => {
      this._resMap.set(`${r.SalaID}-${r.Fecha}-${r.BloqueID}`, r);
    });
  },

  getRes(salaId, fecha, bloqueId) {
    return this._resMap.get(`${salaId}-${fecha}-${bloqueId}`);
  },

  // ── Auto-refresh ──────────────────────────────────────

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(async () => {
      this.loadedYear = null;
      this.allReservations = [];
      await this.ensureYearLoaded();
      this.filterReservationsForView();
      this.renderCurrentView();
    }, 90000);
  },

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  },

  invalidateCache() {
    this.loadedYear = null;
    this.allReservations = [];
    this._resMap = new Map();
  },

  // ── Selection (reservar) ──────────────────────────────

  clearSelection() {
    this.selection = [];
    this.lastClicked = null;
    this.updateSelectionBar();
  },

  isSelected(salaId, fecha, bloqueId) {
    return this.selection.some(s =>
      s.salaId === salaId && s.fecha === fecha && s.bloqueId === bloqueId
    );
  },

  toggleCell(salaId, salaName, fecha, bloqueId, bloqueLabel, blockIndex, event) {
    const isShift = event && event.shiftKey;

    if (isShift && this.lastClicked && this.lastClicked.salaId === salaId && this.lastClicked.fecha === fecha) {
      const from = Math.min(this.lastClicked.blockIndex, blockIndex);
      const to = Math.max(this.lastClicked.blockIndex, blockIndex);
      for (let i = from; i <= to; i++) {
        const block = this.bloques[i];
        if (!block) continue;
        const bId = block.ID;
        if (!this.getRes(salaId, fecha, bId) && !this.isSelected(salaId, fecha, bId)) {
          this.selection.push({ salaId, salaName, fecha, bloqueId: bId, bloqueLabel: block.Etiqueta });
        }
      }
    } else {
      const idx = this.selection.findIndex(s =>
        s.salaId === salaId && s.fecha === fecha && s.bloqueId === bloqueId
      );
      if (idx >= 0) {
        this.selection.splice(idx, 1);
      } else {
        this.selection.push({ salaId, salaName, fecha, bloqueId, bloqueLabel });
      }
    }

    this.lastClicked = { salaId, fecha, blockIndex };
    this.updateSelectionUI();
    this.updateSelectionBar();
  },

  updateSelectionUI() {
    document.querySelectorAll('.cell-selected').forEach(el => el.classList.remove('cell-selected'));
    this.selection.forEach(s => {
      const cell = document.querySelector(`[data-sel="${s.salaId}-${s.fecha}-${s.bloqueId}"]`);
      if (cell) cell.classList.add('cell-selected');
    });
    document.querySelectorAll('.cell-cancel-selected').forEach(el => el.classList.remove('cell-cancel-selected'));
    this.cancelSelection.forEach(s => {
      const cell = document.querySelector(`[data-cancel-sel="${s.reservaId}"]`);
      if (cell) cell.classList.add('cell-cancel-selected');
    });
  },

  updateSelectionBar() {
    const bar = document.getElementById('selection-bar');
    if (this.selection.length === 0) {
      bar.classList.add('d-none');
    } else {
      bar.classList.remove('d-none');
      const groups = {};
      this.selection.forEach(s => {
        const key = `${s.salaId}|${s.fecha}`;
        if (!groups[key]) groups[key] = { salaName: s.salaName, fecha: s.fecha, bloques: [] };
        groups[key].bloques.push(s);
      });
      const lines = Object.values(groups).map(g => {
        const bloques = g.bloques
          .sort((a, b) => a.bloqueId - b.bloqueId)
          .map(s => s.bloqueLabel).join(', ');
        return `<strong>${g.salaName}</strong> — ${g.fecha} — ${g.bloques.length} bloque(s): ${bloques}`;
      });
      document.getElementById('sel-info').innerHTML =
        `${this.selection.length} bloque(s) seleccionado(s):<br>` + lines.join('<br>');
    }

    // Cancel bar
    const cancelBar = document.getElementById('cancel-selection-bar');
    if (this.cancelSelection.length === 0) {
      cancelBar.classList.add('d-none');
    } else {
      cancelBar.classList.remove('d-none');
      const groups = {};
      this.cancelSelection.forEach(s => {
        const key = `${s.salaId}|${s.fecha}`;
        if (!groups[key]) groups[key] = { salaName: s.salaName, fecha: s.fecha, bloques: [] };
        groups[key].bloques.push(s);
      });
      const lines = Object.values(groups).map(g => {
        const bloques = g.bloques
          .sort((a, b) => a.bloqueId - b.bloqueId)
          .map(s => s.bloqueLabel).join(', ');
        return `<strong>${g.salaName}</strong> — ${g.fecha} — ${g.bloques.length} bloque(s): ${bloques}`;
      });
      document.getElementById('cancel-sel-info').innerHTML =
        `${this.cancelSelection.length} reserva(s) para cancelar:<br>` + lines.join('<br>');
    }
  },

  async openSelectionReservation() {
    if (this.selection.length === 0) return;

    const btn = document.querySelector('#selection-bar .btn-success');
    if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }

    try {
      this.invalidateCache();
      await this.ensureYearLoaded();
      this.filterReservationsForView();

      const conflicts = [];
      const valid = this.selection.filter(s => {
        if (this.getRes(s.salaId, s.fecha, s.bloqueId)) {
          conflicts.push(s);
          return false;
        }
        return true;
      });

      if (conflicts.length > 0) {
        this.selection = valid;
        this.updateSelectionUI();
        this.updateSelectionBar();
        this.renderCurrentView();
        App.showToast(`${conflicts.length} bloque(s) ya fueron reservados por otro usuario`, 'warning');
      }

      if (valid.length > 0) {
        App.openMultiReservation(valid);
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Reservar bloques seleccionados'; }
    }
  },

  // ── Selection (cancelar) ──────────────────────────────

  isCancelSelected(reservaId) {
    return this.cancelSelection.some(s => s.reservaId === reservaId);
  },

  toggleCancelCell(reservaId, salaId, salaName, fecha, bloqueId, bloqueLabel) {
    const idx = this.cancelSelection.findIndex(s => s.reservaId === reservaId);
    if (idx >= 0) {
      this.cancelSelection.splice(idx, 1);
    } else {
      this.cancelSelection.push({ reservaId, salaId, salaName, fecha, bloqueId, bloqueLabel });
    }
    this.updateSelectionUI();
    this.updateSelectionBar();
  },

  clearCancelSelection() {
    this.cancelSelection = [];
    this.updateSelectionUI();
    this.updateSelectionBar();
  },

  // ── Recurrence ────────────────────────────────────────

  toggleRecurrence() {
    const options = document.getElementById('recurrence-options');
    const btn = document.getElementById('btn-recurrence');
    const isHidden = options.classList.contains('d-none');
    options.classList.toggle('d-none', !isHidden);
    btn.classList.toggle('active', isHidden);

    if (isHidden) {
      const until = new Date();
      until.setDate(until.getDate() + 21);
      document.getElementById('recurrence-until').value = this.formatDate(until);
    }
  },

  async applyRecurrence() {
    if (this.selection.length === 0) return;

    const untilStr = document.getElementById('recurrence-until').value;
    if (!untilStr) { alert('Selecciona una fecha límite'); return; }

    const patterns = {};
    this.selection.forEach(s => {
      const d = new Date(s.fecha + 'T12:00:00');
      const dayOfWeek = d.getDay();
      const key = `${s.salaId}|${s.bloqueId}|${dayOfWeek}`;
      if (!patterns[key]) {
        patterns[key] = { salaId: s.salaId, salaName: s.salaName, bloqueId: s.bloqueId, bloqueLabel: s.bloqueLabel, dayOfWeek, startDate: s.fecha };
      }
      if (s.fecha < patterns[key].startDate) patterns[key].startDate = s.fecha;
    });

    const untilDate = new Date(untilStr + 'T12:00:00');

    // Load additional year if untilDate is in a different year
    const untilYear = untilDate.getFullYear();
    if (untilYear !== this.loadedYear) {
      const res = await Api.getYearCompact(untilYear);
      if (res.ok) {
        const extra = this.expandCompact(res.data);
        const existingIds = new Set(this.allReservations.map(r => r.ID));
        extra.forEach(r => {
          if (!existingIds.has(r.ID)) this.allReservations.push(r);
        });
        this.buildResMap();
      }
    }

    let added = 0;
    Object.values(patterns).forEach(p => {
      const cursor = new Date(p.startDate + 'T12:00:00');
      cursor.setDate(cursor.getDate() + 7);

      while (cursor <= untilDate) {
        const dateStr = this.formatDate(cursor);
        const salaId = p.salaId;
        const bloqueId = p.bloqueId;

        if (!this.isSelected(salaId, dateStr, bloqueId)) {
          if (!this.getRes(salaId, dateStr, bloqueId)) {
            this.selection.push({
              salaId, salaName: p.salaName, fecha: dateStr, bloqueId, bloqueLabel: p.bloqueLabel
            });
            added++;
          }
        }
        cursor.setDate(cursor.getDate() + 7);
      }
    });

    document.getElementById('recurrence-options').classList.add('d-none');
    document.getElementById('btn-recurrence').classList.remove('active');
    this.updateSelectionUI();
    this.updateSelectionBar();

    if (added > 0) {
      App.showToast(`${added} bloque(s) agregados semanalmente hasta ${untilStr}`, 'success');
    } else {
      App.showToast('No se encontraron bloques libres adicionales', 'warning');
    }
  },

  // ── Data loading ──────────────────────────────────────

  async ensureYearLoaded() {
    const year = this.currentDate.getFullYear();
    const yearsNeeded = new Set([year]);

    // For week view crossing year boundary
    if (this.viewMode === 'week') {
      const monday = this.getMonday(this.currentDate);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      yearsNeeded.add(monday.getFullYear());
      yearsNeeded.add(sunday.getFullYear());
    }

    const missing = [...yearsNeeded].filter(y => y !== this.loadedYear);
    if (missing.length === 0) return;

    const container = document.getElementById('calendar-grid');
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    // Load primary year
    const primaryYear = year;
    const res = await Api.getYearCompact(primaryYear);
    if (res.ok) {
      this.allReservations = this.expandCompact(res.data);
      this.loadedYear = primaryYear;
    }

    // Load additional years if crossing boundary
    for (const y of missing) {
      if (y !== primaryYear) {
        const extraRes = await Api.getYearCompact(y);
        if (extraRes.ok) {
          const extra = this.expandCompact(extraRes.data);
          this.allReservations = this.allReservations.concat(extra);
        }
      }
    }

    this.buildResMap();
  },

  filterReservationsForView() {
    const dateStr = this.formatDate(this.currentDate);
    if (this.viewMode === 'day') {
      this.reservations = this.allReservations.filter(r => r.Fecha === dateStr);
    } else if (this.viewMode === 'week') {
      const monday = this.getMonday(this.currentDate);
      const dates = new Set();
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.add(this.formatDate(d));
      }
      this.reservations = this.allReservations.filter(r => dates.has(r.Fecha));
    } else {
      this.reservations = this.allReservations;
    }
  },

  async loadAndRender() {
    await this.ensureYearLoaded();
    this.filterReservationsForView();
    this.renderCurrentView();
  },

  // ── Render ────────────────────────────────────────────

  renderCurrentView() {
    if (this.viewMode === 'day') {
      document.getElementById('current-date').textContent = this.formatDisplayDate(this.currentDate);
      this.renderDayGrid();
    } else if (this.viewMode === 'week') {
      const monday = this.getMonday(this.currentDate);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      document.getElementById('current-date').textContent =
        `${this.formatDisplayDate(monday)} — ${this.formatDisplayDate(sunday)}`;
      this.renderWeekGrid();
    } else {
      document.getElementById('current-date').textContent = this.formatMonthYear(this.currentDate);
      this.renderMonthGrid();
    }
    this.updateSelectionUI();
  },

  renderOccupiedCell(reserva, userEmail) {
    const isMine = App.isMyEmail(reserva.Email);
    const cls = isMine ? 'cell-mine' : 'cell-occupied';

    if (isMine) {
      const cancelSel = this.isCancelSelected(reserva.ID) ? 'cell-cancel-selected' : '';
      return `<td class="calendar-cell ${cls} ${cancelSel}"
        data-cancel-sel="${reserva.ID}"
        data-res-id="${reserva.ID}" data-sala="${reserva.SalaID}" data-fecha="${reserva.Fecha}" data-bloque="${reserva.BloqueID}"
        title="${reserva.Actividad || 'Reservado'} — Click para cancelar"
        style="cursor:pointer">
        <small><strong>${reserva.Actividad || 'Reservado'}</strong><br>${reserva.Nombre}</small>
      </td>`;
    }

    return `<td class="calendar-cell ${cls}" title="${reserva.Nombre} — ${reserva.Actividad || 'Sin actividad'}">
      <small><strong>${reserva.Actividad || 'Reservado'}</strong><br>${reserva.Nombre}</small>
    </td>`;
  },

  renderFreeCell(salaId, dateStr, blockId, blockIndex) {
    const sel = this.isSelected(salaId, dateStr, blockId);
    return `<td class="calendar-cell cell-free ${sel ? 'cell-selected' : ''}"
      data-sel="${salaId}-${dateStr}-${blockId}"
      data-sala="${salaId}" data-fecha="${dateStr}" data-bloque="${blockId}" data-idx="${blockIndex}"
      title="Click para seleccionar (Shift+click para rango)">
      <small class="text-success">Libre</small>
    </td>`;
  },

  // ── Day View ──────────────────────────────────────────

  renderDayGrid() {
    const container = document.getElementById('calendar-grid');
    const dateStr = this.formatDate(this.currentDate);
    const h = [];

    h.push('<div class="table-responsive"><table class="table table-bordered calendar-table">');
    h.push('<thead><tr><th class="sala-header">Sala</th>');
    this.bloques.forEach(b => {
      h.push(`<th class="text-center">${b.Etiqueta}</th>`);
    });
    h.push('</tr></thead><tbody>');

    this.salas.forEach(sala => {
      h.push(`<tr><td class="sala-header"><strong>${sala.Nombre}</strong><br><small class="text-muted">Cap: ${sala.Capacidad}</small></td>`);
      this.bloques.forEach((block, idx) => {
        const reserva = this.getRes(sala.ID, dateStr, block.ID);
        if (reserva) {
          h.push(this.renderOccupiedCell(reserva));
        } else {
          h.push(this.renderFreeCell(sala.ID, dateStr, block.ID, idx));
        }
      });
      h.push('</tr>');
    });

    h.push('</tbody></table></div>');
    container.innerHTML = h.join('');
  },

  // ── Week View ─────────────────────────────────────────

  renderWeekGrid() {
    const container = document.getElementById('calendar-grid');
    const monday = this.getMonday(this.currentDate);
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const h = [];

    // Pre-compute week dates
    const weekDates = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + d);
      weekDates.push({ date, str: this.formatDate(date), dayNum: date.getDate() });
    }

    this.salas.forEach(sala => {
      h.push(`<h5 class="mt-4 mb-2">${sala.Nombre} <small class="text-muted">(Cap: ${sala.Capacidad})</small></h5>`);
      h.push('<div class="table-responsive"><table class="table table-bordered table-sm calendar-table">');
      h.push('<thead><tr><th></th>');
      weekDates.forEach((wd, d) => {
        h.push(`<th class="text-center">${dayNames[d]} ${wd.dayNum}</th>`);
      });
      h.push('</tr></thead><tbody>');

      this.bloques.forEach((block, idx) => {
        h.push(`<tr><td class="text-nowrap"><small>${block.Etiqueta}</small></td>`);
        weekDates.forEach(wd => {
          const reserva = this.getRes(sala.ID, wd.str, block.ID);
          if (reserva) {
            h.push(this.renderOccupiedCell(reserva));
          } else {
            h.push(this.renderFreeCell(sala.ID, wd.str, block.ID, idx));
          }
        });
        h.push('</tr>');
      });

      h.push('</tbody></table></div>');
    });

    container.innerHTML = h.join('');
  },

  // ── Month View ────────────────────────────────────────

  renderMonthGrid() {
    const container = document.getElementById('calendar-grid');
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();
    const totalBlocks = this.bloques.length;

    const dayStats = {};
    const userEmail = App.currentUser?.Email || '';
    this.reservations.forEach(r => {
      const key = r.Fecha;
      if (!dayStats[key]) dayStats[key] = {};
      if (!dayStats[key][r.SalaID]) dayStats[key][r.SalaID] = { occupied: 0, mine: 0 };
      dayStats[key][r.SalaID].occupied++;
      if (App.isMyEmail(r.Email)) dayStats[key][r.SalaID].mine++;
    });

    const h = [];

    // Sala filter
    h.push(`<div class="mb-3">
      <label class="form-label fw-bold">Sala:</label>
      <select id="month-sala-filter" class="form-select form-select-sm d-inline-block" style="width:auto">
        <option value="">Todas las salas</option>`);
    this.salas.forEach(sala => {
      h.push(`<option value="${sala.ID}">${sala.Nombre}</option>`);
    });
    h.push('</select></div>');

    const selectedSala = document.getElementById('month-sala-filter')?.value || '';

    if (selectedSala) {
      h.push(this.renderMonthDetailedForSala(Number(selectedSala), year, month, totalDays));
    } else {
      h.push(this.renderMonthOverview(year, month, totalDays, totalBlocks, dayStats));
    }

    container.innerHTML = h.join('');
    if (selectedSala) document.getElementById('month-sala-filter').value = selectedSala;
  },

  renderMonthOverview(year, month, totalDays, totalBlocks, dayStats) {
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const todayStr = this.formatDate(new Date());
    const h = [];

    h.push('<div class="table-responsive"><table class="table table-bordered month-table">');
    h.push('<thead><tr>');
    dayNames.forEach(d => { h.push(`<th class="text-center">${d}</th>`); });
    h.push('</tr></thead><tbody><tr>');

    for (let i = 0; i < startOffset; i++) {
      h.push('<td class="month-cell month-cell-empty"></td>');
    }

    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      const dateStr = this.formatDate(date);
      const isToday = dateStr === todayStr;
      const stats = dayStats[dateStr] || {};

      h.push(`<td class="month-cell ${isToday ? 'month-cell-today' : ''}"
        data-goto-day="${dateStr}" title="Click para ver día">
        <div class="month-day-number">${day}</div>
        <div class="month-day-content">`);

      this.salas.forEach(sala => {
        const s = stats[sala.ID];
        if (s) {
          const pct = Math.round((s.occupied / totalBlocks) * 100);
          const barClass = pct >= 80 ? 'bg-danger' : pct >= 40 ? 'bg-warning' : 'bg-success';
          h.push(`<div class="month-lab-row" title="${sala.Nombre}: ${s.occupied}/${totalBlocks} bloques">
            <small class="month-lab-name">${sala.Nombre.substring(0, 8)}</small>
            <div class="progress month-progress">
              <div class="progress-bar ${barClass}" style="width:${pct}%"></div>
            </div>
          </div>`);
        }
      });

      h.push('</div></td>');
      if ((startOffset + day) % 7 === 0 && day < totalDays) h.push('</tr><tr>');
    }

    const remaining = (startOffset + totalDays) % 7;
    if (remaining > 0) {
      for (let i = remaining; i < 7; i++) h.push('<td class="month-cell month-cell-empty"></td>');
    }

    h.push('</tr></tbody></table></div>');
    return h.join('');
  },

  renderMonthDetailedForSala(salaId, year, month, totalDays) {
    const sala = this.salas.find(l => l.ID === salaId);
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const todayStr = this.formatDate(new Date());
    const h = [];

    h.push(`<h5>${sala.Nombre} — Vista detallada del mes</h5>`);
    h.push('<div class="table-responsive"><table class="table table-bordered table-sm calendar-table">');
    h.push('<thead><tr><th>Día</th>');
    this.bloques.forEach(b => {
      h.push(`<th class="text-center"><small>${b.Etiqueta}</small></th>`);
    });
    h.push('</tr></thead><tbody>');

    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      const dateStr = this.formatDate(date);
      const dayOfWeek = (date.getDay() + 6) % 7;
      const isToday = dateStr === todayStr;
      const isWeekend = dayOfWeek >= 5;

      h.push(`<tr class="${isToday ? 'table-info' : ''} ${isWeekend ? 'table-light' : ''}">`);
      h.push(`<td class="text-nowrap"><strong>${dayNames[dayOfWeek]} ${day}</strong></td>`);

      this.bloques.forEach((block, idx) => {
        const reserva = this.getRes(salaId, dateStr, block.ID);
        if (reserva) {
          h.push(this.renderOccupiedCell(reserva));
        } else {
          h.push(this.renderFreeCell(sala.ID, dateStr, block.ID, idx));
        }
      });

      h.push('</tr>');
    }

    h.push('</tbody></table></div>');
    return h.join('');
  },

  goToDay(dateStr) {
    this.currentDate = new Date(dateStr + 'T12:00:00');
    document.getElementById('date-picker').value = dateStr;
    this.viewMode = 'day';
    document.querySelectorAll('.btn-view-mode').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btn-view-day').classList.add('active');
    this.filterReservationsForView();
    this.renderCurrentView();
  }
};
