// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — EQUIPO DETALLADO (solo admin). Enriquece cada usuario con
//  datos que Disapp muestra en su lista de Vendedores: email, último acceso,
//  "conectado" (proxy honesto: login en las últimas 24 h), dispositivos (nº de
//  suscripciones push), ruta (zona), documento, alta y ref de Disapp.
//
//  ⚠️ `email`/`last_sign_in_at` viven en auth.users y las suscripciones push se
//  ven bajo RLS solo por su dueño → ambas se leen con el cliente ADMIN
//  (service_role). createSupabaseAdmin lleva "server-only": este módulo NUNCA
//  debe importarse desde un componente de cliente.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { inicioDiaUYIso, fechaISOUY } from "@/lib/fecha";
import type { Rol } from "@/types/db";
import type { MiembroEquipo } from "@/types/equipo";

export type { MiembroEquipo };

/** Ventana del proxy "conectado": login dentro de las últimas N horas. */
const CONECTADO_HORAS = 24;

export async function getEquipoDetallado(db: SupabaseClient): Promise<MiembroEquipo[]> {
  const admin = createSupabaseAdmin();

  // 1) Usuarios del sistema (RLS: el admin ve todos). select("*") por si alguna
  //    columna nueva (documento/es_dev/disapp_vendedor_id) aún no existe.
  const { data: filas, error } = await db
    .from("usuarios")
    .select("*")
    // Orden alfabético por nombre (lista de vendedores/equipo ordenada A→Z).
    .order("nombre", { ascending: true });
  if (error) throw error;
  const usuarios = (filas ?? []) as Record<string, unknown>[];

  // 2) Zonas (id → nombre) y zonas por supervisor.
  const [{ data: zonasData }, { data: supZonas }] = await Promise.all([
    db.from("zonas").select("id, nombre"),
    db.from("supervisor_zonas").select("supervisor_id, zona_id"),
  ]);
  const zonaNombre = new Map<string, string>();
  for (const z of zonasData ?? []) zonaNombre.set(z.id as string, z.nombre as string);
  const zonasDeSup = new Map<string, string[]>();
  for (const sz of supZonas ?? []) {
    const arr = zonasDeSup.get(sz.supervisor_id as string) ?? [];
    const nom = zonaNombre.get(sz.zona_id as string);
    if (nom) arr.push(nom);
    zonasDeSup.set(sz.supervisor_id as string, arr);
  }

  // 3) Dispositivos: suscripciones push por usuario (con ADMIN, salta RLS).
  const dispositivos = new Map<string, number>();
  try {
    const { data: subs } = await admin.from("push_suscripciones").select("usuario_id");
    for (const s of subs ?? []) {
      const uid = s.usuario_id as string;
      dispositivos.set(uid, (dispositivos.get(uid) ?? 0) + 1);
    }
  } catch {
    /* si 0026 no corrió, dispositivos = 0 */
  }

  // 4) auth.users: email + último acceso (con ADMIN). Paginado (47 usuarios → 1 pág).
  const authInfo = new Map<string, { email: string | null; lastSignIn: string | null }>();
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users ?? []) {
      authInfo.set(u.id, { email: u.email ?? null, lastSignIn: u.last_sign_in_at ?? null });
    }
  } catch {
    /* sin permisos de admin de auth: email/último acceso quedan nulos */
  }

  // 5) ESTADO REAL DE HOY. El "conectado" por login miente: basta con que alguien
  //    (o un script) haya iniciado sesión para que figure activo. Lo que dice si
  //    la persona está TRABAJANDO es: navegó la app hoy, cobró hoy, tiene ruta,
  //    le cargaron base y si ya rindió. Todo con ADMIN (salta RLS por-fila).
  const desdeHoy = inicioDiaUYIso();
  const ultimaVista = new Map<string, string>();
  const cobros = new Map<string, { n: number; monto: number }>();
  const cartera = new Map<string, number>();
  const baseHoy = new Map<string, number>();
  const rindio = new Set<string>();
  await Promise.all([
    (async () => {
      try {
        const { data } = await admin
          .from("eventos_uso")
          .select("usuario_id, creado_en")
          .gte("creado_en", desdeHoy)
          .limit(20000);
        for (const e of data ?? []) {
          const id = e.usuario_id as string | null;
          if (!id) continue;
          const iso = e.creado_en as string;
          const prev = ultimaVista.get(id);
          if (!prev || iso > prev) ultimaVista.set(id, iso);
        }
      } catch {
        /* sin 0064: sin señal de navegación */
      }
    })(),
    (async () => {
      try {
        // Custodia: lo que la persona registró hoy (nativo, no anulado).
        const { data } = await admin
          .from("pagos")
          .select("registrado_por, monto")
          .is("origen", null)
          .eq("anulado", false)
          .gte("registrado_en", desdeHoy)
          .limit(20000);
        for (const p of data ?? []) {
          const id = p.registrado_por as string | null;
          if (!id) continue;
          const acc = cobros.get(id) ?? { n: 0, monto: 0 };
          acc.n += 1;
          acc.monto += Number(p.monto);
          cobros.set(id, acc);
        }
      } catch {
        /* sin pagos legibles: contadores en 0 */
      }
    })(),
    (async () => {
      try {
        for (let i = 0; ; i++) {
          const { data } = await admin
            .from("asignaciones")
            .select("cobrador_id")
            .eq("activo", true)
            .order("id", { ascending: true })
            .range(i * 1000, i * 1000 + 999);
          for (const a of data ?? []) {
            const id = a.cobrador_id as string;
            cartera.set(id, (cartera.get(id) ?? 0) + 1);
          }
          if (!data || data.length < 1000) break;
        }
      } catch {
        /* sin asignaciones: cartera 0 */
      }
    })(),
    (async () => {
      try {
        const { data } = await admin
          .from("aperturas_caja")
          .select("cobrador_id, base")
          .eq("fecha", fechaISOUY());
        for (const a of data ?? []) baseHoy.set(a.cobrador_id as string, Number(a.base));
      } catch {
        /* sin 0105: sin bases */
      }
    })(),
    (async () => {
      try {
        const { data } = await admin
          .from("rendiciones")
          .select("cobrador_id")
          .gte("creado_en", desdeHoy);
        for (const r of data ?? []) rindio.add(r.cobrador_id as string);
      } catch {
        /* sin 0013: nadie figura rendido */
      }
    })(),
  ]);

  const ahora = Date.now();
  return usuarios.map((u) => {
    const rol = u.rol as Rol;
    const authId = (u.auth_user_id as string | null) ?? null;
    const info = authId ? authInfo.get(authId) : undefined;
    const last = info?.lastSignIn ?? null;
    const conectado =
      last != null && ahora - new Date(last).getTime() < CONECTADO_HORAS * 3600 * 1000;
    const ruta =
      rol === "supervisor"
        ? (zonasDeSup.get(u.id as string) ?? []).join(", ") || null
        : u.zona_id
          ? (zonaNombre.get(u.zona_id as string) ?? null)
          : null;
    return {
      id: u.id as string,
      nombre: u.nombre as string,
      rol,
      activo: u.activo as boolean,
      esDev: (u.es_dev as boolean | undefined) ?? false,
      telefono: (u.telefono as string | null) ?? null,
      documento: (u.documento as string | null | undefined) ?? null,
      refDisapp: (u.disapp_vendedor_id as string | null | undefined) ?? null,
      ruta,
      email: info?.email ?? null,
      ultimoAccesoIso: last,
      conectado,
      dispositivos: dispositivos.get(u.id as string) ?? 0,
      creadoEnIso: u.creado_en as string,
      ultimaVistaIso: ultimaVista.get(u.id as string) ?? null,
      cobrosHoy: cobros.get(u.id as string)?.n ?? 0,
      recaudadoHoy: cobros.get(u.id as string)?.monto ?? 0,
      cartera: cartera.get(u.id as string) ?? 0,
      baseHoy: baseHoy.has(u.id as string) ? (baseHoy.get(u.id as string) as number) : null,
      rindio: rindio.has(u.id as string),
      claveCambiadaEn: (u.clave_cambiada_en as string | null | undefined) ?? null,
    };
  });
}
