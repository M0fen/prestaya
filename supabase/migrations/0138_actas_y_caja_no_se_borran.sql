-- ─────────────────────────────────────────────────────────────────────────
--  0138 · LAS ACTAS Y EL LIBRO DE CAJA TAMPOCO SE BORRAN.
--
--  EL HUECO (auditoría de trazabilidad, 10-08).
--  El proyecto tiene una regla que la BASE hace cumplir, no la app: un pago no se
--  borra (`pagos_no_borrar`, 0120) y un crédito no se borra (`prestamos_no_borrar`).
--  Pero las otras dos tablas de plata quedaron sin ese candado:
--
--    · `rendiciones`      — el ACTA de entrega del efectivo. Es el único papel que
--      dice "este cobrador entregó $X este día". Borrarla no solo borra el papel:
--      además DESBLOQUEA la base de caja sellada de ese día, porque el sello se
--      apoya en la existencia del acta. Medido: la base registra 34 borrados ya
--      ejecutados por el canal directo (fueron pruebas — y son la prueba de que la
--      puerta funciona).
--
--    · `movimientos_caja` — el libro de egresos, retiros y aportes. Hoy tiene CERO
--      filas... pero `pg_stat_user_tables` dice 3 inserciones y 3 borrados, y
--      `pg_stat_statements` guarda el DELETE por PostgREST que lo hizo. El único
--      gasto aprobado del piloto (Valentina Ramírez, $1.000 de combustible, 04-08)
--      tiene su solicitud aprobada, su fila de auditoría y su descuento en la
--      rendición — pero su egreso no está. Por eso /admin/caja subdeclara los
--      gastos del piloto en exactamente $1.000.
--
--  POR QUÉ IMPORTA MÁS QUE LOS $1.000. Un libro de plata sin candado de borrado no
--  es un libro: es un borrador. La 0075 ya había quitado la policy de DELETE de
--  `movimientos_caja` con este mismo argumento ("el admin podía BORRAR un egreso y
--  descuadrar el libro sin rastro"), así que por REST nadie puede. Lo que falta es
--  la SEGUNDA capa —la de la base— que es la que protege del script, del import y
--  del service_role distraído. Es exactamente el camino por el que ya se perdieron
--  45 pagos reales de una jornada ($220.960, Valentina 03-08): un script de
--  limpieza abrió la escotilla creyendo que eran pruebas.
--
--  LA ESCOTILLA SE MANTIENE, a propósito y con el mismo diseño que `pagos`: un
--  borrado administrativo excepcional sigue siendo posible, pero hay que PEDIRLO
--  explícito en la misma transacción. La diferencia entre un accidente y una
--  decisión es tener que escribir la decisión.
--
--  SIN RIESGO PARA LO QUE YA FUNCIONA: se verificó que NINGÚN camino de la app
--  borra estas dos tablas (`grep .delete()` sobre lib/ y app/ no las toca).
--  IDEMPOTENTE.
-- ─────────────────────────────────────────────────────────────────────────

-- ── El acta de entrega ─────────────────────────────────────────────────────
create or replace function public.rendiciones_no_borrar()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.permitir_borrado_rendiciones', true), 'off') <> 'on' then
    raise exception
      'Un acta de rendición no se borra: es el único papel que dice que el cobrador entregó la plata (y borrarla desbloquea la base sellada de ese día). Si el acta está mal, corregila con una nueva o dejá la nota. Para un borrado administrativo excepcional, hacé `set local app.permitir_borrado_rendiciones = ''on''` en la misma transacción.';
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_rendiciones_no_borrar on public.rendiciones;
create trigger trg_rendiciones_no_borrar
  before delete on public.rendiciones
  for each row execute function public.rendiciones_no_borrar();

-- ── El libro de caja (egresos, retiros, aportes) ───────────────────────────
create or replace function public.mov_caja_no_borrar()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.permitir_borrado_caja', true), 'off') <> 'on' then
    raise exception
      'El libro de caja es inmutable: un movimiento no se borra (registrá el contrario si hay que corregirlo). Para un borrado administrativo excepcional, hacé `set local app.permitir_borrado_caja = ''on''` en la misma transacción.';
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_mov_caja_no_borrar on public.movimientos_caja;
create trigger trg_mov_caja_no_borrar
  before delete on public.movimientos_caja
  for each row execute function public.mov_caja_no_borrar();

comment on function public.rendiciones_no_borrar() is
  'Candado de borrado del acta de rendición, con escotilla explícita (0138).';
comment on function public.mov_caja_no_borrar() is
  'Candado de borrado del libro de caja, con escotilla explícita (0138).';
