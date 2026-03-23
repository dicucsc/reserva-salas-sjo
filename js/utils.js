/* ============================================
   Shared Utilities
   Sistema de Reserva de Salas SJO
   ============================================ */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function parseEquipos(equiposStr) {
  if (!equiposStr) return [];
  return equiposStr.split(',').map(x => x.trim()).filter(Boolean);
}

function calcEquipUsageForSlots(slots, allReservations, equipos, excludeId) {
  const maxUsage = {};
  equipos.forEach(eq => { maxUsage[eq.ID] = 0; });
  slots.forEach(s => {
    const fecha = s.fecha || s.Fecha;
    const bloqueId = s.bloqueId || s.BloqueID;
    equipos.forEach(eq => {
      let used = 0;
      allReservations.forEach(r => {
        if (r.Fecha === fecha && r.BloqueID === bloqueId && r.ID !== excludeId && r.Equipos) {
          if (parseEquipos(r.Equipos).includes(String(eq.ID))) {
            used++;
          }
        }
      });
      if (used > maxUsage[eq.ID]) maxUsage[eq.ID] = used;
    });
  });
  return maxUsage;
}
