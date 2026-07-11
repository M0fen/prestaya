-- ─────────────────────────────────────────────────────────────────────────
--  0059 — El COBRADOR puede registrar/ver COMPROMISOS de pago de SUS clientes.
--  Extiende gestiones_cobranza (0055) sumando `app_cobrador_tiene_cliente` al
--  using/check (justo lo que 0055 dejó previsto). Así, cuando un cliente promete
--  pagar en la calle ("el viernes te pago"), el cobrador lo deja registrado y el
--  compromiso alimenta el MISMO mini-CRM auto-verificado que ve el supervisor.
--  Sigue append-only (sin UPDATE/DELETE). Re-ejecutable. Correr en SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists gestiones_select on gestiones_cobranza;
create policy gestiones_select on gestiones_cobranza
  for select to authenticated
  using (
    app_es_admin()
    or app_gestor_ve_cliente(cliente_id)
    or app_cobrador_tiene_cliente(cliente_id)
  );

drop policy if exists gestiones_insert on gestiones_cobranza;
create policy gestiones_insert on gestiones_cobranza
  for insert to authenticated
  with check (
    app_es_admin()
    or app_gestor_ve_cliente(cliente_id)
    or app_cobrador_tiene_cliente(cliente_id)
  );
