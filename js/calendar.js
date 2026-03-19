/* ============================================
   Vista Semanal – Grid 2×2 de Salas
   Sistema de Reserva de Salas SJO
   ============================================ */

const Calendar = {
  currentDate: new Date(),
  salas: [],
  bloques: [],
  equipos: [],
  allReservations: [],
  loadedYear: null,
  refreshInterval: null,
  _resMap: new Map(),

  selection: [],
  lastClicked: null,
  cancelSelection: [],
  filterSalaId: null,

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
      this.equipos = initRes.data.equipos || [];
    }

    if (compactRes.ok) {
      this.allReservations = this.expandCompact(compactRes.data);
      this.loadedYear = year;
    }

    this.buildResMap();
    this.setupNavigation();
    this.setupEventDelegation();
    this.buildSalaFilters();
    this.render();
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
        if (e.shiftKey) {
          this.toggleCancelCell(reservaId, salaId, sala ? sala.Nombre : 'Sala ' + salaId, fecha, bloqueId, bloque ? bloque.Etiqueta : 'Bloque ' + bloqueId);
        } else {
          const reserva = this.getRes(salaId, fecha, bloqueId);
          if (reserva) App.openEditReservation(reserva);
        }
      }
    });
  },

  buildSalaFilters() {
    const container = document.getElementById('sala-filters');
    if (!container || this.salas.length === 0) return;

    let html = '<span class="text-muted" style="font-size:0.75rem">Vista:</span>';
    this.salas.forEach(sala => {
      html += `<button class="btn btn-outline-secondary btn-sm btn-sala-filter" data-sala-id="${sala.ID}">${this.escapeHtml(sala.Nombre)}</button>`;
    });
    html += '<button class="btn btn-secondary btn-sm btn-sala-filter active" data-sala-id="all">Todos</button>';
    container.innerHTML = html;

    container.addEventListener('click', e => {
      const btn = e.target.closest('.btn-sala-filter');
      if (!btn) return;
      const val = btn.dataset.salaId;
      this.filterSalaId = val === 'all' ? null : Number(val);
      container.querySelectorAll('.btn-sala-filter').forEach(b => {
        b.classList.remove('active', 'btn-secondary');
        b.classList.add('btn-outline-secondary');
      });
      btn.classList.remove('btn-outline-secondary');
      btn.classList.add('active', 'btn-secondary');
      this.render();
    });
  },

  navigate(dir) {
    this.currentDate.setDate(this.currentDate.getDate() + (dir * 7));
    document.getElementById('date-picker').value = this.formatDate(this.currentDate);
    this.loadAndRender();
  },

  // ── Compact data expansion ─────────────────────────────

  expandCompact(c) {
    return c.r.map(([id, s, doy, b, ui, ai, gi, ci, eq, pi]) => ({
      ID: id,
      SalaID: s,
      Fecha: this.doyToDate(c.y, doy),
      BloqueID: b,
      Email: c.u[ui][0],
      Nombre: c.u[ui][1],
      Actividad: c.a[ai],
      Recurrencia: gi < 0 ? '' : c.g[gi],
      Comentarios: ci < 0 ? '' : (c.c ? c.c[ci] : ''),
      Equipos: eq || '',
      Responsable: (c.p && pi != null) ? c.p[pi] : c.u[ui][1]
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
      await this.reloadData();
      this.render();
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

  async reloadData() {
    const year = this.currentDate.getFullYear();
    const res = await Api.getYearCompact(year);
    if (res.ok) {
      this.allReservations = this.expandCompact(res.data);
      this.loadedYear = year;
      this.buildResMap();
    }
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
    App.openMultiReservation(this.selection);
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

    const monday = this.getMonday(this.currentDate);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    yearsNeeded.add(monday.getFullYear());
    yearsNeeded.add(sunday.getFullYear());

    const missing = [...yearsNeeded].filter(y => y !== this.loadedYear);
    if (missing.length === 0) return;

    // Only show spinner on initial load (no data yet)
    const isInitialLoad = this.allReservations.length === 0 && !this.loadedYear;
    if (isInitialLoad) {
      const container = document.getElementById('calendar-grid');
      container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';
    }

    const primaryYear = year;
    const promises = [Api.getYearCompact(primaryYear)];
    const extraYears = [...missing].filter(y => y !== primaryYear);
    extraYears.forEach(y => promises.push(Api.getYearCompact(y)));

    const results = await Promise.all(promises);

    if (results[0].ok) {
      this.allReservations = this.expandCompact(results[0].data);
      this.loadedYear = primaryYear;
    }

    for (let i = 1; i < results.length; i++) {
      if (results[i].ok) {
        const extra = this.expandCompact(results[i].data);
        this.allReservations = this.allReservations.concat(extra);
      }
    }

    this.buildResMap();
  },

  async loadAndRender() {
    await this.ensureYearLoaded();
    this.render();
  },

  // ── Render ────────────────────────────────────────────

  render() {
    const monday = this.getMonday(this.currentDate);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    document.getElementById('current-date').textContent =
      `${this.formatDisplayDate(monday)} — ${this.formatDisplayDate(sunday)}`;
    this.renderWeekGrid();
    this.updateSelectionUI();
  },

  renderOccupiedCell(reserva) {
    const isMine = App.isMyEmail(reserva.Email);
    const cls = isMine ? 'cell-mine' : 'cell-occupied';
    const act = this.escapeHtml(reserva.Actividad || 'Reservado');
    const displayName = this.escapeHtml((reserva.Responsable || reserva.Nombre || '').split(' ')[0]);
    const resp = this.escapeHtml(reserva.Responsable || reserva.Nombre || '');
    const nombre = this.escapeHtml(reserva.Nombre || '');

    if (isMine) {
      const cancelSel = this.isCancelSelected(reserva.ID) ? 'cell-cancel-selected' : '';
      return `<td class="${cls} ${cancelSel}"
        data-cancel-sel="${reserva.ID}"
        data-res-id="${reserva.ID}" data-sala="${reserva.SalaID}" data-fecha="${reserva.Fecha}" data-bloque="${reserva.BloqueID}"
        title="${act} — Resp: ${resp} — Reservó: ${nombre} — Click para cancelar">
        <div class="cell-act">${act}</div><div class="cell-name">${displayName}</div>
      </td>`;
    }

    return `<td class="${cls}" title="${act} — Resp: ${resp} — Reservó: ${nombre}">
      <div class="cell-act">${act}</div><div class="cell-name">${displayName}</div>
    </td>`;
  },

  renderFreeCell(salaId, dateStr, blockId, blockIndex) {
    const sel = this.isSelected(salaId, dateStr, blockId);
    return `<td class="cell-free ${sel ? 'cell-selected' : ''}"
      data-sel="${salaId}-${dateStr}-${blockId}"
      data-sala="${salaId}" data-fecha="${dateStr}" data-bloque="${blockId}" data-idx="${blockIndex}"
      title="Click para seleccionar (Shift+click para rango)">
    </td>`;
  },

  // ── Week Grid (2×2) ───────────────────────────────────

  renderWeekGrid() {
    const container = document.getElementById('calendar-grid');
    const monday = this.getMonday(this.currentDate);
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const todayStr = this.formatDate(new Date());

    const weekDates = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + d);
      weekDates.push({
        date,
        str: this.formatDate(date),
        label: `${dayNames[d]} ${date.getDate()}`,
        isToday: this.formatDate(date) === todayStr,
        isWeekend: d >= 5
      });
    }

    const visibleSalas = this.filterSalaId != null
      ? this.salas.filter(s => s.ID === this.filterSalaId)
      : this.salas;

    const gridClass = visibleSalas.length === 1 ? 'sala-grid sala-grid-single' : 'sala-grid';
    const h = [`<div class="${gridClass}">`];

    visibleSalas.forEach(sala => {
      h.push(`<div class="sala-panel">`);
      h.push(`<div class="sala-panel-header"><span class="sala-panel-name">${sala.Nombre}</span><span class="sala-panel-cap">Cap. ${sala.Capacidad}</span></div>`);
      h.push('<table class="week-table">');
      h.push('<thead><tr><th class="col-hora">Hora</th>');
      weekDates.forEach(wd => {
        const cls = wd.isToday ? 'col-day col-today' : wd.isWeekend ? 'col-day col-weekend' : 'col-day';
        h.push(`<th class="${cls}">${wd.label}</th>`);
      });
      h.push('</tr></thead><tbody>');

      this.bloques.forEach((block, idx) => {
        h.push(`<tr><td class="col-hora">${block.Etiqueta}</td>`);
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

      h.push('</tbody></table>');
      h.push('</div>');
    });

    h.push('</div>');
    container.innerHTML = h.join('');
  }
};
