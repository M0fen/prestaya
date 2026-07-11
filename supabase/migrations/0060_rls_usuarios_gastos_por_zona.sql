-- ─────────────────────────────────────────────────────────────────────────
--  0060 · Cierra las 2 fugas de LECTURA cross-zona que quedaban (defensa en
--  profundidad: por PostgREST crudo con anon key + su JWT, NO por la UI —la UI
--  ya las corta con requireAdmin()). Espeja lo que 0031/0056 hicieron con
--  clientes/pagos/notas/bitacora/mensajes.
--
--   (A) usuarios_select: hoy usa app_es_gestor() sin acotar → un SUPERVISOR
--       podía leer la tabla `usuarios` COMPLETA (teléfono, documento/cédula,
--       comision_pct, zona) de cobradores y supervisores de TODAS las zonas.
--       Ahora el supervisor ve SOLO: su propia fila, los otros gestores (roster
--       de chat/equipo) y los COBRADORES de SU zona. El admin sigue viendo
--       todo; el cobrador solo su fila (idéntico a hoy).
--
--   (B) solgasto_gestor_select (0057): mismo patrón. El supervisor veía las
--       solicitudes de gasto de cobradores de otras zonas. Ahora acotado con
--       app_gestor_ve_cobrador (helper de 0031, que YA incluye admin y el
--       fallback "supervisor sin zonas ve todo").
--
--  Para no romper la resolución de NOMBRES de autor en el chat (que un
--  supervisor vea el nombre de un cobrador de OTRA zona que postea en el canal
--  'general'), se agrega app_usuarios_nombres(uuid[]) SECURITY DEFINER que
--  devuelve SOLO id+nombre (dato ya visible en el chat, no sensible). El chat
--  resuelve nombres por ahí (ver lib/data/chat.ts); degrada al SELECT directo
--  si esta migración aún no corrió.
--
--  Solo cambia RLS + una función → aplica al instante, sin reload de schema.
--  Re-ejecutable. Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- ── (A) usuarios_select acotado por zona ──────────────────────────────────
--  Nota: en el USING, `usuarios.rol` es la fila EVALUADA (el objetivo); app_rol()
--  es el ACTOR. app_gestor_ve_cobrador(id) resuelve admin / supervisor-sin-zonas
--  (ven todos) y supervisor-con-zonas (solo cobradores de su zona) vía 0031.
drop policy if exists usuarios_select on usuarios;
create policy usuarios_select on usuarios for select to authenticated
  using (
    app_es_admin()                                                             -- admin: todo
    or id = app_usuario_id()                                                   -- cada quien: su propia fila (login/rol)
    or (app_rol() = 'supervisor' and usuarios.rol in ('admin','supervisor'))   -- gestores se ven entre sí (chat/equipo)
    or app_gestor_ve_cobrador(id)                                              -- supervisor: cobradores de SU zona
  );

-- ── Nombres (id+nombre) resolubles por cualquier interno, sin exponer PII ──
--  Names-only: pinta el autor en el chat sin depender del SELECT amplio sobre
--  `usuarios` (ahora acotado por zona). Devuelve nombre y nada más.
create or replace function app_usuarios_nombres(ids uuid[])
returns table(id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select u.id, u.nombre from usuarios u where u.id = any(ids);
$$;
grant execute on function app_usuarios_nombres(uuid[]) to authenticated;

-- ── (B) solicitudes_gasto: el gestor solo ve las de cobradores de su zona ──
drop policy if exists solgasto_gestor_select on solicitudes_gasto;
create policy solgasto_gestor_select on solicitudes_gasto for select
  using ( app_es_admin() or app_gestor_ve_cobrador(cobrador_id) );
