-- ─────────────────────────────────────────────────────────────────────────
--  0130 · PRESUPUESTO DE JUEGOS: los premios pasan a tener PRECIO.
--  Ejecutar en el SQL Editor. Re-ejecutable. Solo agrega columnas (nada se
--  reescribe, nada se borra).
--
--  POR QUÉ: hoy un premio es solo un TEXTO ("1 día de gracia", "5% en tu
--  próxima cuota", "Un televisor 32''"). Ni raspaditas, ni quiniela, ni rifa,
--  ni el canje de estrellas guardan cuánto CUESTA — así que no existe forma de
--  responder "¿cuánto gasté en premios este mes?" ni de saber, antes de
--  regalar 500 raspaditas, cuánta plata se está dejando en la calle.
--
--  DISEÑO (el mismo criterio que el libro de pagos): el costo se CONGELA en el
--  momento del hecho. `raspadita_premios.costo` es el precio de LISTA de hoy;
--  `raspaditas_jugadas.costo` es lo que ese premio valía CUANDO SE ENTREGÓ. Si
--  mañana el dueño sube el costo de "1 día de gracia" de $200 a $300, el
--  historial del mes pasado NO cambia. Sin esto, cualquier reporte histórico
--  se reescribiría solo y el presupuesto sería inauditable.
--
--  El costo es una ESTIMACIÓN del dueño (cuánto le cuesta a la empresa ese
--  beneficio: el día de gracia ≈ un día de interés; el 5% ≈ 5% de la cuota;
--  el televisor ≈ lo que salió). Es plata REAL que se deja de percibir o que
--  se gasta, aunque no salga de la caja como un egreso.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Precio de LISTA (lo edita el admin; puede cambiar en el tiempo) ────────
alter table raspadita_premios add column if not exists costo numeric(12,2) not null default 0
  check (costo >= 0);
comment on column raspadita_premios.costo is
  'Costo estimado para la empresa de entregar este premio, en $. Se congela en raspaditas_jugadas.costo al entregarlo.';

alter table quinielas add column if not exists costo_premio numeric(12,2) not null default 0
  check (costo_premio >= 0);
comment on column quinielas.costo_premio is
  'Costo estimado del premio de esta quiniela. Se paga UNA vez (al ganador) salvo ganadores forzados múltiples.';

alter table rifas add column if not exists costo_premio numeric(12,2) not null default 0
  check (costo_premio >= 0);

-- ── Costo CONGELADO en el hecho (histórico inmutable) ─────────────────────
alter table raspaditas_jugadas add column if not exists costo numeric(12,2) not null default 0
  check (costo >= 0);
comment on column raspaditas_jugadas.costo is
  'Cuánto valía el premio EN EL MOMENTO de jugarlo. No se recalcula si después cambia el precio de lista.';

alter table estrellas_redenciones add column if not exists costo numeric(12,2) not null default 0
  check (costo >= 0);

-- Índices para los cortes por período del panel (día/semana/mes/año).
create index if not exists idx_raspaditas_jugadas_fecha on raspaditas_jugadas (jugado_en);
create index if not exists idx_estrellas_red_resuelto on estrellas_redenciones (resuelto_en);

-- ── Backfill del historial existente ──────────────────────────────────────
-- Las 111 jugadas previas quedan con el costo de lista actual de su premio
-- (0 hasta que el dueño cargue precios). Es lo más honesto que se puede
-- reconstruir: antes de esta migración el dato no existía.
update raspaditas_jugadas j
   set costo = p.costo
  from raspadita_premios p
 where j.premio_id = p.id
   and j.costo = 0
   and p.costo > 0;

-- ── CONGELAR el costo al entregar (trigger, no en el código) ──────────────
-- La jugada se puede insertar por 3 caminos (RPC atómica 0097, RPC con premio
-- fijado 0103, o insert plano de compat). Poner el costo en el trigger lo
-- cubre a TODOS y a los que se agreguen mañana: el hecho queda sellado con el
-- precio del momento, sin depender de que cada camino se acuerde de copiarlo.
create or replace function raspa_congelar_costo()
returns trigger language plpgsql as $$
begin
  if coalesce(NEW.costo, 0) = 0 and NEW.premio_id is not null then
    select coalesce(p.costo, 0) into NEW.costo
      from raspadita_premios p where p.id = NEW.premio_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_raspa_congelar_costo on raspaditas_jugadas;
create trigger trg_raspa_congelar_costo
  before insert on raspaditas_jugadas
  for each row execute function raspa_congelar_costo();

-- ── PRESUPUESTO MENSUAL (opcional, para avisar cuando se pasa) ────────────
create table if not exists presupuesto_juegos (
  id            int primary key default 1 check (id = 1),
  tope_mensual  numeric(12,2) not null default 0 check (tope_mensual >= 0),
  actualizado_por uuid references usuarios(id),
  actualizado_en  timestamptz not null default now()
);
insert into presupuesto_juegos (id) values (1) on conflict (id) do nothing;

alter table presupuesto_juegos enable row level security;
drop policy if exists presu_juegos_select on presupuesto_juegos;
create policy presu_juegos_select on presupuesto_juegos for select to authenticated
  using (app_es_gestor());
drop policy if exists presu_juegos_update on presupuesto_juegos;
create policy presu_juegos_update on presupuesto_juegos for update to authenticated
  using (app_es_admin()) with check (app_es_admin());

-- Verificación:
--   select label, costo from raspadita_premios order by orden;
--   select count(*), sum(costo) from raspaditas_jugadas;
