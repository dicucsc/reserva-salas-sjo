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
  loadedMonth: null,
  viewMode: 'day',
  refreshInterval: null,

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

  getMonthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },

  // ── Init ────────────────────────────────────────────────

  async init() {
    const fecha = this.formatDate(this.currentDate);
    const res = await Api.fullInit(fecha);
    if (res.ok) {
      this.salas = res.data.salas;
      this.bloques = res.data.bloques;
      this.allReservations = res.data.reservas;
      this.loadedMonth = this.getMonthKey(this.currentDate);
    }
    this.setupNavigation();
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

  // ── Auto-refresh ──────────────────────────────────────

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(async () => {
      this.invalidateCache();
      await this.ensureMonthLoaded();
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
    this.loadedMonth = null;
    this.allReservations = [];
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
        const bId = String(block.ID);
        const isOccupied = this.allReservations.some(r =>
          String(r.SalaID) === salaId && String(r.BloqueID) === bId && r.Fecha === fecha
        );
        if (!isOccupied && !this.isSelected(salaId, fecha, bId)) {
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
          .sort((a, b) => Number(a.bloqueId) - Number(b.bloqueId))
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
          .sort((a, b) => Number(a.bloqueId) - Number(b.bloqueId))
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
      await this.ensureMonthLoaded();
      this.filterReservationsForView();

      const conflicts = [];
      const valid = this.selection.filter(s => {
        const occupied = this.allReservations.some(r =>
          String(r.SalaID) === s.salaId && r.Fecha === s.fecha && String(r.BloqueID) === s.bloqueId
        );
        if (occupied) conflicts.push(s);
        return !occupied;
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
      until.setDate(until.getDate() + 21); // 3 semanas por defecto
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

    // Load additional months if needed
    const untilMonth = this.getMonthKey(untilDate);
    const start = new Date(this.currentDate);
    while (this.getMonthKey(start) <= untilMonth) {
      const monthKey = this.getMonthKey(start);
      if (monthKey !== this.loadedMonth) {
        const res = await Api.fullInit(this.formatDate(start));
        if (res.ok) {
          const existingIds = new Set(this.allReservations.map(r => String(r.ID)));
          res.data.reservas.forEach(r => {
            if (!existingIds.has(String(r.ID))) this.allReservations.push(r);
          });
        }
      }
      start.setMonth(start.getMonth() + 1);
    }

    let added = 0;
    Object.values(patterns).forEach(p => {
      const cursor = new Date(p.startDate + 'T12:00:00');
      cursor.setDate(cursor.getDate() + 7);

      while (cursor <= untilDate) {
        const dateStr = this.formatDate(cursor);
        const salaId = String(p.salaId);
        const bloqueId = String(p.bloqueId);

        if (!this.isSelected(salaId, dateStr, bloqueId)) {
          const occupied = this.allReservations.some(r =>
            String(r.SalaID) === salaId && String(r.BloqueID) === bloqueId && r.Fecha === dateStr
          );
          if (!occupied) {
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

  getRequiredMonths() {
    const months = new Set();
    months.add(this.getMonthKey(this.currentDate));
    if (this.viewMode === 'week') {
      const monday = this.getMonday(this.currentDate);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      months.add(this.getMonthKey(monday));
      months.add(this.getMonthKey(sunday));
    }
    return months;
  },

  async ensureMonthLoaded() {
    const required = this.getRequiredMonths();
    const missing = [...required].filter(m => m !== this.loadedMonth);
    if (missing.length === 0) return;

    const container = document.getElementById('calendar-grid');
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    const dateStr = this.formatDate(this.currentDate);
    const res = await Api.fullInit(dateStr);
    if (res.ok) {
      this.allReservations = res.data.reservas;
      this.loadedMonth = this.getMonthKey(this.currentDate);
    }

    for (const m of required) {
      if (m !== this.loadedMonth) {
        const [y, mo] = m.split('-');
        const extraRes = await Api.fullInit(`${y}-${mo}-01`);
        if (extraRes.ok) {
          this.allReservations = this.allReservations.concat(extraRes.data.reservas);
        }
      }
    }
  },

  filterReservationsForView() {
    const dateStr = this.formatDate(this.currentDate);
    if (this.viewMode === 'day') {
      this.reservations = this.allReservations.filter(r => r.Fecha === dateStr);
    } else if (this.viewMode === 'week') {
      const monday = this.getMonday(this.currentDate);
      const dates = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(this.formatDate(d));
      }
      this.reservations = this.allReservations.filter(r => dates.includes(r.Fecha));
    } else {
      this.reservations = this.allReservations;
    }
  },

  async loadAndRender() {
    await this.ensureMonthLoaded();
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
    const isMine = String(reserva.Email).trim().toLowerCase() === userEmail.trim().toLowerCase();
    const cls = isMine ? 'cell-mine' : 'cell-occupied';

    if (isMine) {
      const salaInfo = this.salas.find(l => String(l.ID) === String(reserva.SalaID));
      const salaName = salaInfo ? salaInfo.Nombre : 'Sala ' + reserva.SalaID;
      const blockInfo = this.bloques.find(b => String(b.ID) === String(reserva.BloqueID));
      const bloqueLabel = blockInfo ? blockInfo.Etiqueta : 'Bloque ' + reserva.BloqueID;
      const cancelSel = this.isCancelSelected(String(reserva.ID)) ? 'cell-cancel-selected' : '';
      return `<td class="calendar-cell ${cls} ${cancelSel}"
        data-cancel-sel="${reserva.ID}"
        title="${reserva.Actividad || 'Reservado'} — Click para cancelar"
        onclick="Calendar.toggleCancelCell('${reserva.ID}', '${String(reserva.SalaID)}', '${salaName.replace(/'/g, "\\'")}', '${reserva.Fecha}', '${String(reserva.BloqueID)}', '${bloqueLabel.replace(/'/g, "\\'")}')"
        style="cursor:pointer">
        <small><strong>${reserva.Actividad || 'Reservado'}</strong><br>${reserva.Nombre}</small>
      </td>`;
    }

    return `<td class="calendar-cell ${cls}" title="${reserva.Nombre} — ${reserva.Actividad || 'Sin actividad'}">
      <small><strong>${reserva.Actividad || 'Reservado'}</strong><br>${reserva.Nombre}</small>
    </td>`;
  },

  renderFreeCell(salaId, salaName, dateStr, blockId, blockLabel, blockIndex) {
    const sel = this.isSelected(String(salaId), dateStr, String(blockId));
    return `<td class="calendar-cell cell-free ${sel ? 'cell-selected' : ''}"
      data-sel="${salaId}-${dateStr}-${blockId}"
      onclick="Calendar.toggleCell('${salaId}', '${salaName.replace(/'/g, "\\'")}', '${dateStr}', '${blockId}', '${blockLabel.replace(/'/g, "\\'")}', ${blockIndex}, event)"
      title="Click para seleccionar (Shift+click para rango)">
      <small class="text-success">Libre</small>
    </td>`;
  },

  // ── Day View ──────────────────────────────────────────

  renderDayGrid() {
    const container = document.getElementById('calendar-grid');
    const userEmail = App.currentUser?.Email || '';
    const dateStr = this.formatDate(this.currentDate);

    let html = '<div class="table-responsive"><table class="table table-bordered calendar-table">';
    html += '<thead><tr><th class="sala-header">Sala</th>';
    this.bloques.forEach(b => {
      html += `<th class="text-center">${b.Etiqueta}</th>`;
    });
    html += '</tr></thead><tbody>';

    this.salas.forEach(sala => {
      html += `<tr><td class="sala-header"><strong>${sala.Nombre}</strong><br><small class="text-muted">Cap: ${sala.Capacidad}</small></td>`;
      this.bloques.forEach((block, idx) => {
        const reserva = this.reservations.find(r =>
          String(r.SalaID) === String(sala.ID) && String(r.BloqueID) === String(block.ID)
        );
        if (reserva) {
          html += this.renderOccupiedCell(reserva, userEmail);
        } else {
          html += this.renderFreeCell(sala.ID, sala.Nombre, dateStr, block.ID, block.Etiqueta, idx);
        }
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  },

  // ── Week View ─────────────────────────────────────────

  renderWeekGrid() {
    const container = document.getElementById('calendar-grid');
    const userEmail = App.currentUser?.Email || '';
    const monday = this.getMonday(this.currentDate);
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    let html = '';
    this.salas.forEach(sala => {
      html += `<h5 class="mt-4 mb-2">${sala.Nombre} <small class="text-muted">(Cap: ${sala.Capacidad})</small></h5>`;
      html += '<div class="table-responsive"><table class="table table-bordered table-sm calendar-table">';
      html += '<thead><tr><th></th>';
      for (let d = 0; d < 7; d++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + d);
        html += `<th class="text-center">${dayNames[d]} ${date.getDate()}</th>`;
      }
      html += '</tr></thead><tbody>';

      this.bloques.forEach((block, idx) => {
        html += `<tr><td class="text-nowrap"><small>${block.Etiqueta}</small></td>`;
        for (let d = 0; d < 7; d++) {
          const date = new Date(monday);
          date.setDate(monday.getDate() + d);
          const dateStr = this.formatDate(date);

          const reserva = this.reservations.find(r =>
            String(r.SalaID) === String(sala.ID) &&
            String(r.BloqueID) === String(block.ID) &&
            r.Fecha === dateStr
          );

          if (reserva) {
            html += this.renderOccupiedCell(reserva, userEmail);
          } else {
            html += this.renderFreeCell(sala.ID, sala.Nombre, dateStr, block.ID, block.Etiqueta, idx);
          }
        }
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    });

    container.innerHTML = html;
  },

  // ── Month View ────────────────────────────────────────

  renderMonthGrid() {
    const container = document.getElementById('calendar-grid');
    const userEmail = App.currentUser?.Email || '';
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();
    const totalBlocks = this.bloques.length;

    const dayStats = {};
    this.reservations.forEach(r => {
      const key = r.Fecha;
      if (!dayStats[key]) dayStats[key] = {};
      if (!dayStats[key][r.SalaID]) dayStats[key][r.SalaID] = { occupied: 0, mine: 0 };
      dayStats[key][r.SalaID].occupied++;
      if (String(r.Email).trim().toLowerCase() === userEmail.trim().toLowerCase())
        dayStats[key][r.SalaID].mine++;
    });

    // Lab filter
    let html = `<div class="mb-3">
      <label class="form-label fw-bold">Sala:</label>
      <select id="month-sala-filter" class="form-select form-select-sm d-inline-block" style="width:auto"
        onchange="Calendar.renderMonthGrid()">
        <option value="">Todas las salas</option>`;
    this.salas.forEach(sala => {
      html += `<option value="${sala.ID}">${sala.Nombre}</option>`;
    });
    html += '</select></div>';

    const selectedSala = document.getElementById('month-sala-filter')?.value || '';

    if (selectedSala) {
      html += this.renderMonthDetailedForSala(selectedSala, year, month, totalDays, userEmail);
    } else {
      html += this.renderMonthOverview(year, month, totalDays, totalBlocks, dayStats);
    }

    container.innerHTML = html;
    if (selectedSala) document.getElementById('month-sala-filter').value = selectedSala;
  },

  renderMonthOverview(year, month, totalDays, totalBlocks, dayStats) {
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;

    let html = '<div class="table-responsive"><table class="table table-bordered month-table">';
    html += '<thead><tr>';
    dayNames.forEach(d => { html += `<th class="text-center">${d}</th>`; });
    html += '</tr></thead><tbody><tr>';

    for (let i = 0; i < startOffset; i++) {
      html += '<td class="month-cell month-cell-empty"></td>';
    }

    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      const dateStr = this.formatDate(date);
      const isToday = dateStr === this.formatDate(new Date());
      const stats = dayStats[dateStr] || {};

      html += `<td class="month-cell ${isToday ? 'month-cell-today' : ''}"
        onclick="Calendar.goToDay('${dateStr}')" title="Click para ver día">
        <div class="month-day-number">${day}</div>
        <div class="month-day-content">`;

      this.salas.forEach(sala => {
        const s = stats[sala.ID];
        if (s) {
          const pct = Math.round((s.occupied / totalBlocks) * 100);
          const barClass = pct >= 80 ? 'bg-danger' : pct >= 40 ? 'bg-warning' : 'bg-success';
          html += `<div class="month-lab-row" title="${sala.Nombre}: ${s.occupied}/${totalBlocks} bloques">
            <small class="month-lab-name">${sala.Nombre.substring(0, 8)}</small>
            <div class="progress month-progress">
              <div class="progress-bar ${barClass}" style="width:${pct}%"></div>
            </div>
          </div>`;
        }
      });

      html += '</div></td>';
      if ((startOffset + day) % 7 === 0 && day < totalDays) html += '</tr><tr>';
    }

    const remaining = (startOffset + totalDays) % 7;
    if (remaining > 0) {
      for (let i = remaining; i < 7; i++) html += '<td class="month-cell month-cell-empty"></td>';
    }

    html += '</tr></tbody></table></div>';
    return html;
  },

  renderMonthDetailedForSala(salaId, year, month, totalDays, userEmail) {
    const sala = this.salas.find(l => String(l.ID) === String(salaId));
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    let html = `<h5>${sala.Nombre} — Vista detallada del mes</h5>`;
    html += '<div class="table-responsive"><table class="table table-bordered table-sm calendar-table">';
    html += '<thead><tr><th>Día</th>';
    this.bloques.forEach(b => {
      html += `<th class="text-center"><small>${b.Etiqueta}</small></th>`;
    });
    html += '</tr></thead><tbody>';

    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      const dateStr = this.formatDate(date);
      const dayOfWeek = (date.getDay() + 6) % 7;
      const isToday = dateStr === this.formatDate(new Date());
      const isWeekend = dayOfWeek >= 5;

      html += `<tr class="${isToday ? 'table-info' : ''} ${isWeekend ? 'table-light' : ''}">`;
      html += `<td class="text-nowrap"><strong>${dayNames[dayOfWeek]} ${day}</strong></td>`;

      this.bloques.forEach((block, idx) => {
        const reserva = this.reservations.find(r =>
          String(r.SalaID) === String(salaId) &&
          String(r.BloqueID) === String(block.ID) &&
          r.Fecha === dateStr
        );
        if (reserva) {
          html += this.renderOccupiedCell(reserva, userEmail);
        } else {
          html += this.renderFreeCell(sala.ID, sala.Nombre, dateStr, block.ID, block.Etiqueta, idx);
        }
      });

      html += '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
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
