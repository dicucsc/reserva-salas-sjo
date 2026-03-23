# Reserva de Salas SJO

## Estado del proyecto
- **En producción** desde marzo 2026. Los usuarios ya están subiendo datos reales de reservas.

## Reglas críticas
- **NO modificar, eliminar ni alterar datos de producción** (tablas de reservas, usuarios, configuración) sin confirmación explícita del usuario.
- Cualquier migración o cambio de esquema debe ser aditivo y no destructivo.
- No ejecutar scripts de limpieza, seed, o reset contra la base de datos de producción.
- Ante la duda, preguntar antes de actuar sobre datos existentes.
