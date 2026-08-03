-- ─────────────────────────────────────────────────────────────────────────
-- 0126 — LIBRO INMUTABLE a nivel BASE + registro de RESPALDOS.
-- Correr en el SQL Editor. Re-ejecutable. Va DESPUÉS de 0125.
--
-- Contexto (auditoría de seguridad/fidelidad 08-03): la última capa de defensa
-- de los datos no es el código TypeScript (un insider con JWT válido habla
-- PostgREST crudo y lo esquiva) sino la base. `pagos` ya está blindada (0120
-- borrar vetado, 0121 campos financieros congelados). Esta migración cierra lo
-- que FALTABA:
--
--  (A) `prestamos` era EDITABLE por cualquier gestor vía REST (policy 0002:
--      app_es_gestor). Un supervisor podía subirle `total_dias` o `cuota_diaria`
--      a un crédito activo (el cliente pasa a deber MÁS días sin que nadie firme
--      nada) o resucitar un crédito finalizado — y NINGUNA invariante lo
--      detectaba: INV1 vigila pagado_acum, INV2 el sobre-cobro, pero el "total a
--      pagar" en sí no tenía testigo. Ahora los términos del crédito quedan
--      CONGELADOS para los roles de API (authenticated/anon):
--        · fijos: cliente_id, monto_prestado, cuota_diaria, total_dias,
--          fecha_inicio, frecuencia, origen, interes_pct, op_id, renovado_de,
--          producto_id, producto_nombre, disapp_credit_ref, creado_por, creado_en.
--        · estado: solo 'activo' → finalizado/cancelado/refinanciado. La vuelta
--          (resucitar) exige service_role — la usa SOLO la compensación de
--          renovación, que desde hoy corre con el cliente admin del servidor.
--        · pagado_acum: solo lo escriben los caminos de confianza (el trigger
--          0063 y la RPC de reparación 0119 corren como el dueño de la función,
--          no como 'authenticated', así que pasan solos).
--        · finalizado_en solo puede cambiar JUNTO con un cambio de estado (el
--          backfill histórico se hace por SQL Editor, que es rol de confianza).
--      cobrador_id queda editable (reasignación de ruta, flujo legítimo).
--      service_role y el SQL Editor NO se tocan: son las vías de reparación.
--
--  (B) BORRAR un crédito queda vetado para TODOS salvo escotilla explícita
--      (mismo diseño que 0120 para pagos): un crédito con historia jamás se
--      borra, y uno recién creado se cancela, no se borra. Escotilla:
--         begin; set local app.permitir_borrado_prestamos = 'on'; delete ...; commit;
--
--  (C) DES-ANULACIÓN de pagos (anulado true→false) vetada para TODOS salvo
--      escotilla. Anular es one-way por diseño (el libro es la verdad); revertir
--      una anulación re-suma plata al crédito y hoy ningún flujo del negocio lo
--      hace — si algún día hace falta, es una decisión consciente en el SQL Editor:
--         begin; set local app.permitir_desanulacion = 'on'; update ...; commit;
--
--  (D) `clientes.token_acceso` congelado para los roles de API: es la LLAVE de la
--      vista del cliente. Un gestor podía reescribirla por REST y apuntar el
--      acceso de un cliente a un token que él conoce (suplantación silenciosa).
--      La rotación legítima del admin corre con service_role desde hoy.
--
--  (E) `backups_log` — registro de cada respaldo lógico (scripts/backup-completo).
--      El panel de Empalme muestra "último respaldo verificado hace X días" y
--      grita si pasan >7 días: un respaldo que no se corre es la falla silenciosa
--      más peligrosa de todas. Solo lectura para el admin; escribe el script
--      (service_role).
--
-- Los triggers aplican a TODOS los roles de API aunque la RLS ya recorte: RLS
-- decide QUIÉN toca una fila; esto decide QUÉ se puede tocar de ella. Cinturón
-- y tiradores, como corresponde con plata de terceros.
-- ─────────────────────────────────────────────────────────────────────────

-- ══ (A) prestamos: términos congelados + máquina de estados ═════════════════
create or replace function prestamos_guardia_escritura()
returns trigger language plpgsql as $$
begin
  -- Solo se restringe a los roles de la API (PostgREST). El dueño de la base,
  -- las funciones SECURITY DEFINER (corren como su dueño) y service_role son
  -- vías de confianza: reparaciones, RPCs de dinero e importadores.
  if current_user in ('authenticated', 'anon') then
    if NEW.cliente_id          is distinct from OLD.cliente_id
       or NEW.monto_prestado   is distinct from OLD.monto_prestado
       or NEW.cuota_diaria     is distinct from OLD.cuota_diaria
       or NEW.total_dias       is distinct from OLD.total_dias
       or NEW.fecha_inicio     is distinct from OLD.fecha_inicio
       or NEW.frecuencia       is distinct from OLD.frecuencia
       or NEW.origen           is distinct from OLD.origen
       or NEW.interes_pct      is distinct from OLD.interes_pct
       or NEW.op_id            is distinct from OLD.op_id
       or NEW.renovado_de      is distinct from OLD.renovado_de
       or NEW.producto_id      is distinct from OLD.producto_id
       or NEW.producto_nombre  is distinct from OLD.producto_nombre
       or NEW.disapp_credit_ref is distinct from OLD.disapp_credit_ref
       or NEW.creado_por       is distinct from OLD.creado_por
       or NEW.creado_en        is distinct from OLD.creado_en then
      raise exception 'Los términos de un crédito son inmutables (monto/cuota/días/fecha/origen). Una corrección se hace por renovación, anulación de pagos o reparación administrativa.'
        using errcode = 'P0403';
    end if;

    -- pagado_acum lo mantiene el trigger del libro (0063) y lo repara la RPC
    -- 0119 — ambos corren como el dueño de la función. Un PATCH directo es
    -- alguien maquillando el saldo a mano.
    if NEW.pagado_acum is distinct from OLD.pagado_acum then
      raise exception 'pagado_acum lo mantiene el libro de pagos; no se edita a mano.'
        using errcode = 'P0403';
    end if;

    -- Máquina de estados: un crédito solo AVANZA. Resucitar uno finalizado
    -- re-abre deuda ya saldada (o borra la traza de una renovación).
    if NEW.estado is distinct from OLD.estado then
      if not (OLD.estado = 'activo'
              and NEW.estado in ('finalizado', 'cancelado', 'refinanciado')) then
        raise exception 'Transición de estado no permitida (%→%): un crédito no se resucita por la API.', OLD.estado, NEW.estado
          using errcode = 'P0403';
      end if;
    elsif NEW.finalizado_en is distinct from OLD.finalizado_en then
      -- finalizado_en cuenta CUÁNDO cerró: solo cambia junto con el estado.
      raise exception 'finalizado_en solo cambia junto con un cambio de estado.'
        using errcode = 'P0403';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_prestamos_guardia on prestamos;
create trigger trg_prestamos_guardia
  before update on prestamos
  for each row execute function prestamos_guardia_escritura();

-- ══ (B) prestamos: borrar vetado (espejo de 0120 para pagos) ═════════════════
create or replace function prestamos_no_borrar()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.permitir_borrado_prestamos', true), 'off') <> 'on' then
    raise exception
      'Un crédito no se borra (cancelalo o dejalo finalizar). Para un borrado administrativo excepcional: set local app.permitir_borrado_prestamos = ''on'' en la misma transacción.'
      using errcode = 'P0403';
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_prestamos_no_borrar on prestamos;
create trigger trg_prestamos_no_borrar
  before delete on prestamos
  for each row execute function prestamos_no_borrar();

-- ══ (C) pagos: des-anulación one-way (extiende 0121, mismo trigger) ══════════
-- Cuerpo IDÉNTICO a 0121 + el gate de des-anulación. El trigger existente
-- (trg_pagos_inmutables) ya apunta a esta función: el REPLACE alcanza.
create or replace function pagos_no_editar_financiero()
returns trigger language plpgsql as $$
begin
  if NEW.monto          is distinct from OLD.monto
     or NEW.prestamo_id    is distinct from OLD.prestamo_id
     or NEW.dia_credito    is distinct from OLD.dia_credito
     or NEW.registrado_por is distinct from OLD.registrado_por
     or NEW.registrado_en  is distinct from OLD.registrado_en
     or NEW.gps_lat        is distinct from OLD.gps_lat
     or NEW.gps_lng        is distinct from OLD.gps_lng then
    raise exception 'Los datos financieros y la ubicación de un pago no se modifican. Use anulación.'
      using errcode = 'P0403';
  end if;

  -- Anular es ONE-WAY: revertirlo re-suma plata al crédito (el trigger 0063 la
  -- devuelve) y ningún flujo del negocio lo hace. Si un día hace falta, es una
  -- decisión consciente en el SQL Editor, no un PATCH.
  if OLD.anulado = true and NEW.anulado = false
     and coalesce(current_setting('app.permitir_desanulacion', true), 'off') <> 'on' then
    raise exception
      'Una anulación no se revierte por la API. Para revertirla deliberadamente: set local app.permitir_desanulacion = ''on'' en la misma transacción.'
      using errcode = 'P0403';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_pagos_inmutables on pagos;
create trigger trg_pagos_inmutables
  before update on pagos
  for each row execute function pagos_no_editar_financiero();

-- ══ (D) clientes.token_acceso: la llave del cliente no se toca por la API ════
create or replace function clientes_proteger_token()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon')
     and NEW.token_acceso is distinct from OLD.token_acceso then
    raise exception 'El token de acceso del cliente solo se rota desde la acción del admin (service_role).'
      using errcode = 'P0403';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_clientes_token on clientes;
create trigger trg_clientes_token
  before update on clientes
  for each row execute function clientes_proteger_token();

-- ══ (E) backups_log: registro de respaldos (para el panel de Empalme) ════════
create table if not exists backups_log (
  id           uuid primary key default gen_random_uuid(),
  corrido_en   timestamptz not null default now(),
  origen       text not null default 'manual',
  tablas       int not null,
  filas_total  bigint not null,
  bytes        bigint not null,
  destino      text,
  verificado   boolean not null default false,
  incompleto   boolean not null default false,
  detalle      jsonb
);
comment on table backups_log is
  'Cada corrida de scripts/backup-completo.mjs deja una fila. El panel de Empalme alerta si el último respaldo VERIFICADO tiene más de 7 días.';

alter table backups_log enable row level security;
drop policy if exists backups_log_admin_select on backups_log;
create policy backups_log_admin_select on backups_log
  for select to authenticated using ( app_es_admin() );
-- Sin policies de escritura: inserta SOLO el script de respaldo (service_role).

create index if not exists idx_backups_log_corrido on backups_log (corrido_en desc);
