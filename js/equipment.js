// ============================================
// Selector de Equipos
// ============================================

const Equipment = {
  allEquipment: [],
  availability: [],
  selected: new Map(), // equipoId -> cantidad
  categories: [],

  async loadCatalog() {
    // Catálogo ya se carga desde Api.fullInit() en Calendar.init()
    // Este método queda por compatibilidad
    if (this.allEquipment.length > 0) return;
    const res = await Api.getEquipment();
    if (res.ok) {
      this.allEquipment = res.data;
      this.categories = [...new Set(res.data.map(e => e.Categoria).filter(Boolean))].sort();
    }
  },

  async loadAvailability(labId, fecha, bloqueId) {
    const res = await Api.getAvailability(labId, fecha, bloqueId);
    if (res.ok) {
      this.availability = res.data;
    }
  },

  // Calcular disponibilidad client-side usando datos ya cacheados
  computeAvailability(labId, fecha, bloqueId) {
    // Filtrar equipos relevantes (del lab o generales)
    const relevant = this.allEquipment.filter(eq =>
      String(eq.LabID) === '' || String(eq.LabID) === String(labId)
    );

    // Encontrar reservas del mismo bloque+fecha
    const blockReservations = Calendar.allReservations.filter(r =>
      r.Fecha === fecha && String(r.BloqueID) === String(bloqueId)
    );

    // Calcular disponibilidad
    this.availability = relevant.map(eq => {
      let reservados = 0;
      blockReservations.forEach(r => {
        if (r.equipos) {
          r.equipos.forEach(re => {
            if (String(re.EquipoID) === String(eq.ID))
              reservados += Number(re.Cantidad);
          });
        }
      });
      return {
        ...eq,
        CantidadTotal: Number(eq.Cantidad),
        Reservados: reservados,
        Disponible: Number(eq.Cantidad) - reservados
      };
    });
  },

  getFiltered(searchText, category) {
    let items = this.availability;
    if (searchText) {
      const q = searchText.toLowerCase();
      items = items.filter(e =>
        e.Nombre.toLowerCase().includes(q) ||
        (e.Descripcion && e.Descripcion.toLowerCase().includes(q))
      );
    }
    if (category) {
      items = items.filter(e => e.Categoria === category);
    }
    return items;
  },

  reset() {
    this.selected.clear();
    this.availability = [];
  },

  setQuantity(equipoId, cantidad) {
    if (cantidad <= 0) {
      this.selected.delete(equipoId);
    } else {
      this.selected.set(equipoId, cantidad);
    }
  },

  getSelectedList() {
    return Array.from(this.selected.entries()).map(([equipoId, cantidad]) => {
      const eq = this.availability.find(e => String(e.ID) === String(equipoId));
      return { equipoId, cantidad, nombre: eq ? eq.Nombre : equipoId };
    });
  },

  renderSelector(containerId) {
    const container = document.getElementById(containerId);
    const searchText = document.getElementById('equip-search')?.value || '';
    const category = document.getElementById('equip-category')?.value || '';
    const items = this.getFiltered(searchText, category);

    let html = '';
    if (items.length === 0) {
      html = '<p class="text-muted text-center py-3">No se encontraron equipos</p>';
    } else {
      html = '<div class="list-group">';
      items.forEach(eq => {
        const disponible = eq.Disponible;
        const selected = this.selected.get(String(eq.ID)) || 0;
        const disabled = disponible <= 0 && selected <= 0;

        html += `
          <div class="list-group-item ${disabled ? 'list-group-item-light' : ''}">
            <div class="d-flex justify-content-between align-items-center">
              <div class="flex-grow-1">
                <strong>${eq.Nombre}</strong>
                <span class="badge bg-secondary ms-2">${eq.Categoria}</span>
                ${eq.Descripcion ? `<br><small class="text-muted">${eq.Descripcion}</small>` : ''}
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="badge ${disponible > 0 ? 'bg-success' : 'bg-danger'}">
                  ${disponible} de ${eq.CantidadTotal} disp.
                </span>
                <input type="number" class="form-control form-control-sm equip-qty"
                  style="width: 70px" min="0" max="${disponible}"
                  value="${selected}" data-equip-id="${eq.ID}"
                  ${disabled ? 'disabled' : ''}
                  onchange="Equipment.onQuantityChange(this)">
              </div>
            </div>
          </div>`;
      });
      html += '</div>';
    }
    container.innerHTML = html;
    this.renderSummary();
  },

  onQuantityChange(input) {
    const id = input.dataset.equipId;
    const val = parseInt(input.value) || 0;
    this.setQuantity(String(id), val);
    this.renderSummary();
  },

  renderSummary() {
    const container = document.getElementById('equip-summary');
    if (!container) return;
    const items = this.getSelectedList();
    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted mb-0">No se han seleccionado equipos</p>';
      return;
    }
    let html = '<strong>Equipos seleccionados:</strong><ul class="mb-0 mt-1">';
    items.forEach(item => {
      html += `<li>${item.nombre} × ${item.cantidad}</li>`;
    });
    html += '</ul>';
    container.innerHTML = html;
  },

  renderCategoryFilter(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    let html = '<option value="">Todas las categorías</option>';
    this.categories.forEach(cat => {
      html += `<option value="${cat}">${cat}</option>`;
    });
    select.innerHTML = html;
  }
};
