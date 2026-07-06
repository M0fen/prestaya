-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — RETIRO de la mascota (tamagotchi).
--  Mauricio decidió quitar la mascota; la reemplaza la "línea de comportamiento"
--  con caritas (derivada del cartón, sin tabla propia). El código ya no usa la
--  tabla `mascotas`.
--
--  SEGURO EN PRODUCCIÓN: solo dropea la tabla si está VACÍA. Si tuviera filas
--  (datos reales), NO la borra: la marca como obsoleta y la deja para que la
--  revises/exportes antes de eliminarla a mano. Re-ejecutable.
--  Ejecutar en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  filas bigint;
begin
  if to_regclass('public.mascotas') is null then
    raise notice 'La tabla mascotas no existe: nada que hacer.';
    return;
  end if;

  execute 'select count(*) from public.mascotas' into filas;

  if filas = 0 then
    drop table public.mascotas;
    raise notice 'Tabla mascotas vacía: eliminada.';
  else
    comment on table public.mascotas is
      'OBSOLETA — mascota retirada (migración 0019). Conserva % filas; revisar/exportar antes de dropear a mano.';
    raise notice 'Tabla mascotas con % filas: NO se elimina. Marcada como obsoleta.', filas;
  end if;
end $$;
