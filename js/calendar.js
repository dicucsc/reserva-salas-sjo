// ============================================
// Vista de Calendario / Grilla de Ocupación
// ============================================

const Calendar = {
  currentDate: new Date(),
  labs: [],
  blocks: [],
  reservations: [],    // reservas filtradas para la vista actual
  allReservations: [], // cache de todas las reservas del mes cargado
  loadedMonth: null,   // 'YYYY-MM' del mes actualmente en cache
  viewMode: 'day', // 'day', 'week', 'month'
  refreshInterval: null,

  // Selección múltiple de celdas (acumulativa, tipo Excel)
  selection: [], // [{ labId, labName, fecha, bloqueId, bloqueLabel }]
  lastClicked: null, // { labId, fecha, blockIndex } para shift+click

  formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

  async init() {
    // fullInit: labs + blocks + equipment + reservations del mes en 1 sola llamada
    const fecha = this.formatDate(this.currentDate);
    const res = await Api.fullInit(fecha);
    if (res.ok) {
      this.labs = res.data.labs;
      this.blocks = res.data.blocks;
      Equipment.allEquipment = res.data.equipment;
      Equipment.categories = [...new Set(res.data.equipment.map(e => e.Categoria).filter(Boolean))].sort();
      this.allReservations = res.data.reservations;
      this.loadedMonth = this.getMonthKey(this.currentDate);
    }
    this.setupNavigation();
    this.filterReservationsForView();

    const dateStr = this.formatDate(this.currentDate);
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

  // --- Auto-refresh ---

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(async () => {
      this.invalidateCache();
      await this.ensureMonthLoaded();
      this.filterReservationsForView();
      this.renderCurrentView();
    }, 90000); // cada 90 segundos
  },

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  },

  // --- Selección múltiple ---

  invalidateCache() {
    this.loadedMonth = null;
    this.allReservations = [];
  },

  clearSelection() {
    this.selection = [];
    this.lastClicked = null;
    this.updateSelectionBar();
  },

  isSelected(labId, fecha, bloqueId) {
    return this.selection.some(s =>
      s.labId === labId && s.fecha === fecha && s.bloqueId === bloqueId
    );
  },

  toggleCell(labId, labName, fecha, bloqueId, bloqueLabel, blockIndex, event) {
    const isShift = event && event.shiftKey;

    if (isShift && this.lastClicked && this.lastClicked.labId === labId && this.lastClicked.fecha === fecha) {
      // Shift+click: seleccionar rango en mismo lab+fecha
      const from = Math.min(this.lastClicked.blockIndex, blockIndex);
      const to = Math.max(this.lastClicked.blockIndex, blockIndex);
      for (let i = from; i <= to; i++) {
        const block = this.blocks[i];
        if (!block) continue;
        const bId = String(block.ID);
        const isOccupied = this.allReservations.some(r =>
          String(r.LabID) === labId && String(r.BloqueID) === bId && r.Fecha === fecha
        );
        if (!isOccupied && !this.isSelected(labId, fecha, bId)) {
          this.selection.push({ labId, labName, fecha, bloqueId: bId, bloqueLabel: block.Etiqueta });
        }
      }
    } else {
      // Click normal: toggle individual (acumulativo)
      const idx = this.selection.findIndex(s =>
        s.labId === labId && s.fecha === fecha && s.bloqueId === bloqueId
      );
      if (idx >= 0) {
        this.selection.splice(idx, 1);
      } else {
        this.selection.push({ labId, labName, fecha, bloqueId, bloqueLabel });
      }
    }

    this.lastClicked = { labId, fecha, blockIndex };
    this.updateSelectionUI();
    this.updateSelectionBar();
  },

  updateSelectionUI() {
    // Quitar clase de todas las celdas
    document.querySelectorAll('.cell-selected').forEach(el => el.classList.remove('cell-selected'));
    // Agregar clase a las seleccionadas
    this.selection.forEach(s => {
      const cell = document.querySelector(`[data-sel="${s.labId}-${s.fecha}-${s.bloqueId}"]`);
      if (cell) cell.classList.add('cell-selected');
    });
  },

  updateSelectionBar() {
    const bar = document.getElementById('selection-bar');
    if (this.selection.length === 0) {
      bar.classList.add('d-none');
      return;
    }

    bar.classList.remove('d-none');

    // Agrupar selección por lab+fecha
    const groups = {};
    this.selection.forEach(s => {
      const key = `${s.labId}|${s.fecha}`;
      if (!groups[key]) groups[key] = { labName: s.labName, fecha: s.fecha, bloques: [] };
      groups[key].bloques.push(s);
    });

    const lines = Object.values(groups).map(g => {
      const bloques = g.bloques
        .sort((a, b) => Number(a.bloqueId) - Number(b.bloqueId))
        .map(s => s.bloqueLabel)
        .join(', ');
      return `<strong>${g.labName}</strong> — ${g.fecha} — ${g.bloques.length} bloque(s): ${bloques}`;
    });

    document.getElementById('sel-info').innerHTML =
      `${this.selection.length} bloque(s) seleccionado(s):<br>` + lines.join('<br>');
  },

  async openSelectionReservation() {
    if (this.selection.length === 0) return;

    const btn = document.querySelector('#selection-bar .btn-success');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Verificando disponibilidad...';
    }

    try {
      // Refrescar datos del mes (force reload)
      this.invalidateCache();
      await this.ensureMonthLoaded();
      this.filterReservationsForView();

      // Verificar cuáles bloques siguen libres
      const conflicts = [];
      const valid = this.selection.filter(s => {
        const occupied = this.allReservations.some(r =>
          String(r.LabID) === s.labId && r.Fecha === s.fecha && String(r.BloqueID) === s.bloqueId
        );
        if (occupied) conflicts.push(s);
        return !occupied;
      });

      if (conflicts.length > 0) {
        this.selection = valid;
        this.updateSelectionUI();
        this.updateSelectionBar();
        // Re-render grid con datos frescos
        this.renderCurrentView();
        App.showToast(`${conflicts.length} bloque(s) ya fueron reservados por otro usuario`, 'warning');
      }

      if (valid.length > 0) {
        App.openMultiReservation(valid);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Reservar bloques seleccionados';
      }
    }
  },

  // --- Render helpers ---

  renderCurrentView() {
    if (this.viewMode === 'day') this.renderDayGrid();
    else if (this.viewMode === 'week') this.renderWeekGrid();
    else this.renderMonthGrid();
    this.updateSelectionUI();
  },

  // --- Render ---

  getMonthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },

  // Determina qué meses necesita la vista actual
  getRequiredMonths() {
    const months = new Set();
    months.add(this.getMonthKey(this.currentDate));

    if (this.viewMode === 'week') {
      // La semana puede cruzar meses
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

    if (missing.length === 0) return; // ya está en cache

    // Cargar el mes principal (si la semana cruza meses, cargamos el del currentDate)
    const container = document.getElementById('calendar-grid');
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    const dateStr = this.formatDate(this.currentDate);
    const res = await Api.getMonth(dateStr);
    if (res.ok) {
      this.allReservations = res.data;
      this.loadedMonth = this.getMonthKey(this.currentDate);
    }

    // Si la semana cruza al mes anterior/siguiente, cargar también
    for (const m of required) {
      if (m !== this.loadedMonth) {
        const [y, mo] = m.split('-');
        const extraRes = await Api.getMonth(`${y}-${mo}-01`);
        if (extraRes.ok) {
          this.allReservations = this.allReservations.concat(extraRes.data);
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

    const dateStr = this.formatDate(this.currentDate);

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
    const clickAttr = isMine
      ? `onclick="App.openCancelModal('${reserva.ID}')" style="cursor:pointer"`
      : '';
    const tip = isMine
      ? `${reserva.Actividad || 'Reservado'} — Click para cancelar`
      : `${reserva.Nombre} — ${reserva.Actividad || 'Sin actividad'}`;
    return `<td class="calendar-cell ${cls}" title="${tip}" ${clickAttr}>
      <small><strong>${reserva.Actividad || 'Reservado'}</strong><br>${reserva.Nombre}</small>
    </td>`;
  },

  renderFreeCell(labId, labName, dateStr, blockId, blockLabel, blockIndex) {
    const sel = this.isSelected(String(labId), dateStr, String(blockId));
    return `<td class="calendar-cell cell-free ${sel ? 'cell-selected' : ''}"
      data-sel="${labId}-${dateStr}-${blockId}"
      onclick="Calendar.toggleCell('${labId}', '${labName}', '${dateStr}', '${blockId}', '${blockLabel}', ${blockIndex}, event)"
      title="Click para seleccionar (Shift+click para rango)">
      <small class="text-success">Libre</small>
    </td>`;
  },

  renderDayGrid() {
    const container = document.getElementById('calendar-grid');
    const userEmail = App.currentUser?.Email || '';
    const dateStr = this.formatDate(this.currentDate);

    let html = '<div class="table-responsive"><table class="table table-bordered calendar-table">';
    html += '<thead><tr><th class="lab-header">Laboratorio</th>';
    this.blocks.forEach(b => {
      html += `<th class="text-center">${b.Etiqueta}</th>`;
    });
    html += '</tr></thead><tbody>';

    this.labs.forEach(lab => {
      html += `<tr><td class="lab-header"><strong>${lab.Nombre}</strong><br><small class="text-muted">Cap: ${lab.Capacidad} | ${lab.Ubicacion}</small></td>`;
      this.blocks.forEach((block, idx) => {
        const reserva = this.reservations.find(r =>
          String(r.LabID) === String(lab.ID) && String(r.BloqueID) === String(block.ID)
        );
        if (reserva) {
          html += this.renderOccupiedCell(reserva, userEmail);
        } else {
          html += this.renderFreeCell(lab.ID, lab.Nombre, dateStr, block.ID, block.Etiqueta, idx);
        }
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  },

  renderWeekGrid() {
    const container = document.getElementById('calendar-grid');
    const userEmail = App.currentUser?.Email || '';
    const monday = this.getMonday(this.currentDate);
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    let html = '';
    this.labs.forEach(lab => {
      html += `<h5 class="mt-4 mb-2">${lab.Nombre} <small class="text-muted">(${lab.Ubicacion}, Cap: ${lab.Capacidad})</small></h5>`;
      html += '<div class="table-responsive"><table class="table table-bordered table-sm calendar-table">';
      html += '<thead><tr><th></th>';
      for (let d = 0; d < 7; d++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + d);
        html += `<th class="text-center">${dayNames[d]} ${date.getDate()}</th>`;
      }
      html += '</tr></thead><tbody>';

      this.blocks.forEach((block, idx) => {
        html += `<tr><td class="text-nowrap"><small>${block.Etiqueta}</small></td>`;
        for (let d = 0; d < 7; d++) {
          const date = new Date(monday);
          date.setDate(monday.getDate() + d);
          const dateStr = this.formatDate(date);

          const reserva = this.reservations.find(r =>
            String(r.LabID) === String(lab.ID) &&
            String(r.BloqueID) === String(block.ID) &&
            r.Fecha === dateStr
          );

          if (reserva) {
            html += this.renderOccupiedCell(reserva, userEmail);
          } else {
            html += this.renderFreeCell(lab.ID, lab.Nombre, dateStr, block.ID, block.Etiqueta, idx);
          }
        }
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    });

    container.innerHTML = html;
  },

  renderMonthGrid() {
    const container = document.getElementById('calendar-grid');
    const userEmail = App.currentUser?.Email || '';
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();
    const totalBlocks = this.blocks.length;

    const dayStats = {};
    this.reservations.forEach(r => {
      const key = r.Fecha;
      if (!dayStats[key]) dayStats[key] = {};
      if (!dayStats[key][r.LabID]) dayStats[key][r.LabID] = { occupied: 0, mine: 0 };
      dayStats[key][r.LabID].occupied++;
      if (String(r.Email).trim().toLowerCase() === userEmail.trim().toLowerCase())
        dayStats[key][r.LabID].mine++;
    });

    let html = `<div class="mb-3">
      <label class="form-label fw-bold">Laboratorio:</label>
      <select id="month-lab-filter" class="form-select form-select-sm d-inline-block" style="width:auto"
        onchange="Calendar.renderMonthGrid()">
        <option value="">Todos los laboratorios</option>`;
    this.labs.forEach(lab => {
      html += `<option value="${lab.ID}">${lab.Nombre}</option>`;
    });
    html += '</select></div>';

    const selectedLab = document.getElementById('month-lab-filter')?.value || '';

    if (selectedLab) {
      html += this.renderMonthDetailedForLab(selectedLab, year, month, totalDays, userEmail);
    } else {
      html += this.renderMonthOverview(year, month, totalDays, totalBlocks, dayStats, userEmail);
    }

    container.innerHTML = html;

    if (selectedLab) {
      document.getElementById('month-lab-filter').value = selectedLab;
    }
  },

  renderMonthOverview(year, month, totalDays, totalBlocks, dayStats, userEmail) {
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
        onclick="Calendar.goToDay('${dateStr}')">
        <div class="month-day-number">${day}</div>
        <div class="month-day-content">`;

      this.labs.forEach(lab => {
        const s = stats[lab.ID];
        if (s) {
          const pct = Math.round((s.occupied / totalBlocks) * 100);
          const barClass = pct >= 80 ? 'bg-danger' : pct >= 40 ? 'bg-warning' : 'bg-success';
          html += `<div class="month-lab-row" title="${lab.Nombre}: ${s.occupied}/${totalBlocks} bloques ocupados${s.mine ? ' (' + s.mine + ' tuyas)' : ''}">
            <small class="month-lab-name">${lab.Nombre.replace('Laboratorio de ', '')}</small>
            <div class="progress month-progress">
              <div class="progress-bar ${barClass}" style="width:${pct}%"></div>
            </div>
          </div>`;
        }
      });

      html += '</div></td>';

      const cellIndex = startOffset + day;
      if (cellIndex % 7 === 0 && day < totalDays) {
        html += '</tr><tr>';
      }
    }

    const remaining = (startOffset + totalDays) % 7;
    if (remaining > 0) {
      for (let i = remaining; i < 7; i++) {
        html += '<td class="month-cell month-cell-empty"></td>';
      }
    }

    html += '</tr></tbody></table></div>';
    return html;
  },

  renderMonthDetailedForLab(labId, year, month, totalDays, userEmail) {
    const lab = this.labs.find(l => String(l.ID) === String(labId));
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    let html = `<h5>${lab.Nombre} — Vista detallada del mes</h5>`;
    html += '<div class="table-responsive"><table class="table table-bordered table-sm calendar-table">';
    html += '<thead><tr><th>Día</th>';
    this.blocks.forEach(b => {
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

      this.blocks.forEach((block, idx) => {
        const reserva = this.reservations.find(r =>
          String(r.LabID) === String(labId) &&
          String(r.BloqueID) === String(block.ID) &&
          r.Fecha === dateStr
        );

        if (reserva) {
          html += this.renderOccupiedCell(reserva, userEmail);
        } else {
          html += this.renderFreeCell(lab.ID, lab.Nombre, dateStr, block.ID, block.Etiqueta, idx);
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
    this.setViewMode('day');
  }
};
