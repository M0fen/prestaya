-- ─────────────────────────────────────────────────────────────────────────
--  0095 · Restaura los canales 'zona' y 'supervisores' del chat.
--
--  REGRESIÓN: 0033 (chat_grupos) definió mensajes_select/insert con 4 ramas
--  (general / cobrador / zona / supervisores). 0056 —más nueva— recreó AMBAS
--  policies con solo 3 ramas (general, cobrador_id=self, app_gestor_ve_cobrador),
--  omitiendo 'zona' y 'supervisores'. Efecto: para un supervisor CON zona (Mauricio)
--  y para los cobradores, el canal de ZONA y el de SUPERVISORES aparecen en la UI
--  pero devuelven [] y el envío falla ("No se pudo enviar") → chats muertos en el
--  setup del piloto. No era una fuga (0056 restringió de más, en dirección segura),
--  pero rompió esos canales.
--
--  Se restauran las policies de 0033 (correctas: la rama 'zona' sigue acotada por
--  app_supervisa_zona/app_mi_zona y 'supervisores' por app_es_gestor → sin fuga
--  entre zonas). Solo cambia RLS → aplica al instante. Re-ejecutable. SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists mensajes_select on mensajes;
create policy mensajes_select on mensajes for select to authenticated
  using (
    ambito = 'general'
    or (ambito = 'supervisores' and app_es_gestor())
    or (ambito = 'cobrador'
        and ( app_gestor_ve_cobrador(cobrador_id) or cobrador_id = app_usuario_id() ))
    or (ambito = 'zona'
        and ( app_es_admin() or app_supervisa_zona(zona_id) or app_mi_zona() = zona_id ))
  );

drop policy if exists mensajes_insert on mensajes;
create policy mensajes_insert on mensajes for insert to authenticated
  with check (
    autor_id = app_usuario_id()
    and (
      ambito = 'general'
      or (ambito = 'supervisores' and app_es_gestor())
      or (ambito = 'cobrador'
          and ( app_gestor_ve_cobrador(cobrador_id) or cobrador_id = app_usuario_id() ))
      or (ambito = 'zona'
          and ( app_es_admin() or app_supervisa_zona(zona_id) or app_mi_zona() = zona_id ))
    )
  );
