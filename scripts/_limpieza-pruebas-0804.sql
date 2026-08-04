-- LIMPIEZA de datos de PRUEBA pre-piloto (08-03/04) — correr en el SQL Editor.
-- Generado por scripts/empalme-0804 · 2026-08-04T00:37
-- Los 50 pagos de prueba YA están anulados (no cuentan en ningún saldo); este SQL
-- los PURGA del libro para que el historial del cliente quede impecable, y borra
-- el crédito de prueba del alta (vetado por 0126 para la API, escotilla adrede).

begin;

-- 1) Purga de los 50 pagos de prueba (todos anulados; disapp_pago_id NULL, 08-03/04)
set local app.permitir_borrado_pagos = 'on';
delete from pagos where id in (
  '50a8076c-0d3a-4f1f-b2d1-09fcbc5a6fbd',
  'eab6a1fa-e42d-49c5-ab3c-4a30d005f9ef',
  'fc19a781-5804-4217-8a3d-575beefb437d',
  'c666e90a-d13b-4322-83cd-cbecf99f871f',
  'bd3ddd80-c005-4342-aa78-bb6dcc4b0496',
  'b8b51b5a-b5b0-4fa2-a58f-3589a27964b9',
  'd6f08295-b034-4ae7-875b-f417ba5412a7',
  '9b2a51b8-21fb-4f7e-9f3a-2a1d199d9179',
  '6a0e9580-ed89-49a3-a4d4-e45000d7c4f3',
  'dcbd1192-7821-439a-a506-89cb673cb8bc',
  '6d57b83d-8464-4e27-a9ba-26b30a9091f9',
  '349943d6-e146-49d5-a243-0ad92118c87d',
  '72a31cb5-2e55-4ddc-ac8b-161f2e8c2a14',
  '0c58246c-0a58-45f5-8a7f-c72e0ebeb136',
  '0f198751-33f5-446a-a81d-12b203124955',
  '844575e7-59e1-456d-9055-cf2a402652ba',
  '1578f33a-3a4b-42bc-9940-337efa67592d',
  '3df26ba0-afe5-43dc-94c5-59ada0d829a1',
  '6453d642-6435-420c-8774-f0bd2408834e',
  'f9621650-f03c-4fd9-9999-e0dbad45afdd',
  'f3d8c430-6df7-4331-95b6-9358ac8dd5bc',
  'e64432be-f32e-4c23-9fd9-cc93d8d80e09',
  '8d3606eb-632a-46ca-a8ed-94464a6bf58c',
  '2d8a167d-bfba-4a67-b0ef-3f6ce782bcaf',
  'eb3f5b97-8dd6-49a3-80e9-ea07f28a1e7a',
  'cfff3e73-e99f-4346-9689-f5affaeb76be',
  '8aafc490-1dcd-4bf3-8ca6-d8570f180fc3',
  '67249ffc-2460-4d91-864b-8aba36b98ab1',
  '974b4029-66c6-4a94-bac5-e9626bc927a6',
  '82291cc8-dda6-4489-af8b-3d8dca093f51',
  'eda64bb9-3d28-442e-afe8-162fb614a20e',
  '6badaa9f-b4f7-46f1-900c-e18ec9abc785',
  '71352925-b42f-46a6-8678-c87350308236',
  '3cb7ca4a-7c5c-42cb-8cdd-94ca2ec5c248',
  'd2c56656-f159-4295-83f3-3e9085f8f92a',
  '587820be-049a-4747-9ca8-37e40e4eab54',
  'e53a8214-e09f-4935-963f-59bcec9e7fea',
  'e4e1dcc9-468d-411c-84c6-b0b7eca0f61a',
  '95ab5308-4376-4dc6-842a-fec679e4c448',
  '60eaa047-56e9-44d3-91b0-888e33d22c6e',
  '87ec7290-43dd-4454-8ae5-58999892a976',
  '036317e3-5070-4ea2-838e-0e3a4f755d67',
  'c23a1875-0a6a-4042-92d4-a773a44fdbb0',
  '54b4344d-03b6-415a-8015-bb34e37ff9d2',
  'ec211835-9685-49ab-865d-f954a768757a',
  '2c512485-4a81-44d8-942b-bbc705dd0cd7',
  'c6042fb0-7ca3-4a56-9def-297495285024',
  'c54948fa-f0ae-4de1-8e39-3ce3b22ebad8',
  'ad20d504-a3eb-41a1-97dc-fba5410da80d',
  '08621d29-fbf6-401f-8684-4de4afcffdc3'
);

-- 2) Crédito de prueba del alta (Valentina, $20.000 x 24d, origen='credito')
set local app.permitir_borrado_prestamos = 'on';
delete from prestamos where id = 'a0512b35-cdf5-467f-a7d8-b896965e3ed1';

commit;

-- Verificación: ambas consultas deben dar 0
select count(*) as pagos_prueba from pagos where disapp_pago_id is null and registrado_en >= '2026-08-01';
select count(*) as prestamos_prueba from prestamos where disapp_credit_id is null and origen = 'credito' and creado_en >= '2026-08-03';
