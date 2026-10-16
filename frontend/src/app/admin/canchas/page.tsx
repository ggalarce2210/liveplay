'use client';

import { Suspense, useEffect, useState } from 'react';
import clsx from 'clsx';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/AppShell';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type {
  Complex,
  Court,
  Camera,
  ImouDevice,
  SportType,
  CameraType,
  CourtOperatingHours,
  MercadoPagoConnectionStatus,
  ComplexCreationResult,
  VideoAccessPassesResponse,
} from '@/types';

const SPORT_LABELS: Record<SportType, string> = { FUTBOL5: 'Fútbol 5', PADEL: 'Pádel' };
/** Duración de turno sugerida por defecto según el deporte — el encargado la puede cambiar. */
const DEFAULT_TURN_MINUTES: Record<SportType, number> = { PADEL: 90, FUTBOL5: 60 };
const WEEK_DAYS: { iso: number; label: string }[] = [
  { iso: 1, label: 'Lun' },
  { iso: 2, label: 'Mar' },
  { iso: 3, label: 'Mié' },
  { iso: 4, label: 'Jue' },
  { iso: 5, label: 'Vie' },
  { iso: 6, label: 'Sáb' },
  { iso: 7, label: 'Dom' },
];
const CAMERA_TYPE_LABELS: Record<string, string> = {
  IP_CAMERA: 'Cámara IP',
  RTSP: 'RTSP genérica',
  NVR: 'NVR',
  DVR: 'DVR',
  IMOU_CLOUD: 'Imou Cloud',
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** Chip de estado reutilizado para cámaras y canchas. */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ONLINE: 'bg-pitch-500/15 text-pitch-400',
    ACTIVE: 'bg-pitch-500/15 text-pitch-400',
    OFFLINE: 'bg-red-500/15 text-red-400',
    INACTIVE: 'bg-red-500/15 text-red-400',
    UNKNOWN: 'bg-ink-700/60 text-ink-300',
    MAINTENANCE: 'bg-amber-500/15 text-amber-400',
  };
  const labels: Record<string, string> = {
    ONLINE: '🟢 Online',
    OFFLINE: '🔴 Offline',
    UNKNOWN: '⚪ Sin datos',
    ACTIVE: 'Activa',
    MAINTENANCE: 'Mantenimiento',
    INACTIVE: 'Inactiva',
  };
  return <span className={clsx('badge', map[status] ?? 'bg-ink-700/60 text-ink-300')}>{labels[status] ?? status}</span>;
}

export default function CanchasAdminPage() {
  const [complexes, setComplexes] = useState<Complex[] | null>(null);
  const [selectedComplexId, setSelectedComplexId] = useState<string | null>(null);
  const [courts, setCourts] = useState<Court[] | null>(null);
  const [courtsError, setCourtsError] = useState<string | null>(null);

  const [showNewComplex, setShowNewComplex] = useState(false);
  const [showNewCourt, setShowNewCourt] = useState(false);

  const [deletingComplex, setDeletingComplex] = useState(false);
  const [deleteComplexError, setDeleteComplexError] = useState<string | null>(null);

  // Los dispositivos Imou se piden una sola vez (lista global de la cuenta) y se comparten
  // entre todos los formularios de "agregar cámara" que se abran en esta página.
  const [imouDevices, setImouDevices] = useState<ImouDevice[] | null>(null);
  const [imouDevicesError, setImouDevicesError] = useState<string | null>(null);
  const [loadingImouDevices, setLoadingImouDevices] = useState(false);

  async function loadComplexes() {
    const data = await api.get<Complex[]>('/complexes');
    setComplexes(data);
    if (!selectedComplexId && data.length > 0) setSelectedComplexId(data[0].id);
  }

  async function loadCourts(complexId: string) {
    setCourts(null);
    setCourtsError(null);
    try {
      const data = await api.get<Court[]>(`/courts?complexId=${complexId}`);
      setCourts(data);
    } catch (err) {
      setCourtsError(errorMessage(err, 'No pudimos cargar las canchas de este complejo'));
      setCourts([]);
    }
  }

  useEffect(() => {
    loadComplexes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedComplexId) loadCourts(selectedComplexId);
  }, [selectedComplexId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ensureImouDevices() {
    if (imouDevices || loadingImouDevices) return;
    setLoadingImouDevices(true);
    setImouDevicesError(null);
    try {
      const data = await api.get<ImouDevice[]>('/cameras/imou/devices');
      setImouDevices(data);
    } catch (err) {
      setImouDevicesError(errorMessage(err, 'No pudimos consultar los dispositivos de Imou'));
    } finally {
      setLoadingImouDevices(false);
    }
  }

  const selectedComplex = complexes?.find((c) => c.id === selectedComplexId) ?? null;

  /** Borra el complejo entero (cascada: sus canchas, cámaras, suscripción y partidos) — pensado
   * para poder "arrancar de cero" con un complejo de prueba cargado mal, sin tener que borrar
   * cancha por cancha y cámara por cámara a mano. Solo lo puede hacer SUPER_ADMIN (ver
   * ComplexesController.remove del backend). */
  async function onDeleteComplex() {
    if (!selectedComplex) return;
    if (
      !window.confirm(
        `¿Eliminar el complejo "${selectedComplex.name}"? Esto borra también todas sus canchas, cámaras y partidos. No se puede deshacer.`,
      )
    ) {
      return;
    }
    setDeletingComplex(true);
    setDeleteComplexError(null);
    try {
      await api.delete(`/complexes/${selectedComplex.id}`);
      setSelectedComplexId(null);
      setCourts(null);
      await loadComplexes();
    } catch (err) {
      setDeleteComplexError(errorMessage(err, 'No pudimos eliminar el complejo'));
    } finally {
      setDeletingComplex(false);
    }
  }

  return (
    <AuthGuard>
      <AppShell>
        <div className="mx-auto max-w-6xl px-6 py-8">
          <h1 className="text-2xl font-bold text-white">Canchas y cámaras</h1>
          <p className="mb-6 text-sm text-ink-400">Alta de complejos, canchas y vinculación de cámaras (Imou Cloud o RTSP/IP propia).</p>

          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            {/* Columna de complejos */}
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-300">Complejos</h2>
                <button className="text-xs font-semibold text-pitch-400 hover:text-pitch-300" onClick={() => setShowNewComplex((v) => !v)}>
                  {showNewComplex ? 'Cancelar' : '+ Nuevo'}
                </button>
              </div>

              {showNewComplex && (
                <NewComplexForm
                  onCreated={async (complex) => {
                    setShowNewComplex(false);
                    await loadComplexes();
                    setSelectedComplexId(complex.id);
                  }}
                />
              )}

              {!complexes && <p className="text-sm text-ink-400">Cargando...</p>}
              {complexes?.length === 0 && !showNewComplex && <p className="text-sm text-ink-400">Todavía no hay complejos cargados.</p>}

              <div className="mt-2 space-y-1">
                {complexes?.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedComplexId(c.id)}
                    className={clsx(
                      'block w-full rounded-lg px-3 py-2 text-left text-sm transition',
                      c.id === selectedComplexId ? 'bg-pitch-500/15 text-pitch-400' : 'text-ink-300 hover:bg-ink-800/60 hover:text-white',
                    )}
                  >
                    <span className="block font-medium">{c.name}</span>
                    {c.city && <span className="block text-xs text-ink-400">{c.city}</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Columna de canchas del complejo seleccionado */}
            <div className="space-y-4">
              {!selectedComplex && complexes && complexes.length > 0 && (
                <div className="card p-5 text-sm text-ink-400">Elegí un complejo de la izquierda.</div>
              )}

              {selectedComplex && (
                <>
                  <div className="card p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-white">{selectedComplex.name}</h2>
                        {selectedComplex.city && <p className="text-sm text-ink-400">{selectedComplex.city}</p>}
                      </div>
                      <div className="flex items-center gap-4">
                        <button className="btn-secondary" onClick={() => setShowNewCourt((v) => !v)}>
                          {showNewCourt ? 'Cancelar' : '+ Nueva cancha'}
                        </button>
                        <button
                          className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-60"
                          onClick={onDeleteComplex}
                          disabled={deletingComplex}
                        >
                          {deletingComplex ? 'Eliminando...' : '🗑 Eliminar complejo'}
                        </button>
                      </div>
                    </div>
                    {deleteComplexError && <p className="mt-2 text-xs text-red-400">{deleteComplexError}</p>}
                  </div>

                  <Suspense fallback={null}>
                    <VideoAccessSettingsCard complex={selectedComplex} onChanged={loadComplexes} />
                  </Suspense>

                  <VideoAccessPaymentsCard complexId={selectedComplex.id} />

                  {showNewCourt && (
                    <div className="card p-5">
                      <NewCourtForm
                        complexId={selectedComplex.id}
                        onCreated={async () => {
                          setShowNewCourt(false);
                          await loadCourts(selectedComplex.id);
                        }}
                      />
                    </div>
                  )}

                  {courtsError && <div className="card border-red-500/30 p-4 text-sm text-red-400">{courtsError}</div>}

                  {courts === null && !courtsError && <div className="card p-5 text-sm text-ink-400">Cargando canchas...</div>}
                  {courts?.length === 0 && <div className="card p-5 text-sm text-ink-400">Este complejo todavía no tiene canchas cargadas.</div>}

                  {courts?.map((court) => (
                    <CourtCard
                      key={court.id}
                      court={court}
                      imouDevices={imouDevices}
                      imouDevicesError={imouDevicesError}
                      loadingImouDevices={loadingImouDevices}
                      ensureImouDevices={ensureImouDevices}
                      onChanged={() => loadCourts(selectedComplex.id)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

/**
 * Cobro por ver videos (2026-10-16): toggle + precio/días de pase (guardan en `complexes` vía
 * PATCH normal) + conexión de la cuenta de Mercado Pago DEL PROPIO COMPLEJO (modelo
 * marketplace: la plata entra directo ahí, LivePlay se queda con una comisión — ver
 * backend/src/payments/mercadopago.service.ts). Sin la cuenta conectada, el cobro no funciona
 * aunque el toggle esté prendido: el checkout del lado del jugador fallaría, así que se lo
 * avisamos acá mismo al encargado.
 */
function VideoAccessSettingsCard({ complex, onChanged }: { complex: Complex | null; onChanged: () => void }) {
  const searchParams = useSearchParams();
  const mpRedirectStatus = searchParams.get('mp'); // 'connected' | 'error' | null, viene del callback OAuth

  const [charges, setCharges] = useState(false);
  const [priceArs, setPriceArs] = useState('');
  const [passDays, setPassDays] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [mpStatus, setMpStatus] = useState<MercadoPagoConnectionStatus | null>(null);
  const [mpLoading, setMpLoading] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);

  useEffect(() => {
    setCharges(complex?.chargesForVideoAccess ?? false);
    setPriceArs(complex?.videoAccessPriceArs != null ? String(complex.videoAccessPriceArs) : '');
    setPassDays(complex?.videoAccessPassDays != null ? String(complex.videoAccessPassDays) : '');
    setSaveOk(false);
    setSaveError(null);
  }, [complex?.id, complex?.chargesForVideoAccess, complex?.videoAccessPriceArs, complex?.videoAccessPassDays]);

  useEffect(() => {
    if (!complex?.id) return;
    setMpStatus(null);
    setMpError(null);
    api
      .get<MercadoPagoConnectionStatus>(`/complexes/${complex.id}/mercadopago/status`)
      .then(setMpStatus)
      .catch((err) => setMpError(errorMessage(err, 'No pudimos consultar el estado de Mercado Pago')));
  }, [complex?.id, mpRedirectStatus]);

  if (!complex) return null;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await api.patch(`/complexes/${complex!.id}`, {
        chargesForVideoAccess: charges,
        videoAccessPriceArs: charges ? Number(priceArs) : null,
        videoAccessPassDays: charges ? Number(passDays) : null,
      });
      setSaveOk(true);
      onChanged();
    } catch (err) {
      setSaveError(errorMessage(err, 'No pudimos guardar la configuración de cobro'));
    } finally {
      setSaving(false);
    }
  }

  async function onConnectMercadoPago() {
    setMpLoading(true);
    setMpError(null);
    try {
      const { url } = await api.get<{ url: string }>(`/complexes/${complex!.id}/mercadopago/connect-url`);
      window.location.href = url;
    } catch (err) {
      setMpError(errorMessage(err, 'No pudimos iniciar la conexión con Mercado Pago'));
      setMpLoading(false);
    }
  }

  async function onDisconnectMercadoPago() {
    if (!window.confirm('¿Desconectar la cuenta de Mercado Pago de este complejo? Mientras no se vuelva a conectar, no se van a poder cobrar nuevos pases.')) return;
    setMpLoading(true);
    setMpError(null);
    try {
      await api.delete(`/complexes/${complex!.id}/mercadopago`);
      setMpStatus({ connected: false, mpUserId: null, connectedAt: null });
    } catch (err) {
      setMpError(errorMessage(err, 'No pudimos desconectar Mercado Pago'));
    } finally {
      setMpLoading(false);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Cobro por ver videos</h3>

      {mpRedirectStatus === 'connected' && (
        <p className="rounded-lg border border-pitch-500/40 bg-pitch-500/10 px-3 py-2 text-xs text-pitch-300">
          ✅ Cuenta de Mercado Pago conectada.
        </p>
      )}
      {mpRedirectStatus === 'error' && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          No se pudo completar la conexión con Mercado Pago. Probá de nuevo.
        </p>
      )}

      <form onSubmit={onSave} className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={charges} onChange={(e) => setCharges(e.target.checked)} />
          Este complejo cobra por ver los videos de sus partidos
        </label>

        {charges && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-400">
              Precio del pase (ARS)
              <input
                required
                type="number"
                min={1}
                step="0.01"
                className="input-field mt-1"
                value={priceArs}
                onChange={(e) => setPriceArs(e.target.value)}
              />
            </label>
            <label className="text-xs text-ink-400">
              Duración del pase (días)
              <input
                required
                type="number"
                min={1}
                step="1"
                className="input-field mt-1"
                value={passDays}
                onChange={(e) => setPassDays(e.target.value)}
              />
            </label>
          </div>
        )}

        {saveError && <p className="text-xs text-red-400">{saveError}</p>}
        {saveOk && <p className="text-xs text-pitch-400">Guardado.</p>}
        <button type="submit" disabled={saving} className="btn-secondary !py-1.5 text-xs">
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </form>

      {charges && (
        <div className="border-t border-ink-800 pt-3">
          <p className="mb-2 text-xs text-ink-400">
            La plata de cada pase entra directo a la cuenta de Mercado Pago de este complejo (no a una cuenta de LivePlay) — hace falta
            conectarla una vez.
          </p>
          {mpError && <p className="mb-2 text-xs text-red-400">{mpError}</p>}
          {!mpStatus ? (
            <p className="text-xs text-ink-400">Consultando estado de Mercado Pago...</p>
          ) : mpStatus.connected ? (
            <div className="flex items-center justify-between">
              <span className="badge bg-pitch-500/15 text-pitch-400">🟢 Mercado Pago conectado</span>
              <button className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-60" onClick={onDisconnectMercadoPago} disabled={mpLoading}>
                {mpLoading ? 'Desconectando...' : 'Desconectar'}
              </button>
            </div>
          ) : (
            <button className="btn-primary !py-1.5 text-xs" onClick={onConnectMercadoPago} disabled={mpLoading}>
              {mpLoading ? 'Redirigiendo...' : 'Conectar Mercado Pago'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Alta de complejo (2026-10-16): cada complejo es un cliente propio con su propio usuario
 * administrador (ver ComplexesService.create) — por eso el formulario pide también el
 * email/nombre/apellido de ese admin, no solo los datos del complejo. La respuesta trae una
 * contraseña temporal en texto plano que solo se muestra ACÁ, una sola vez (nunca se vuelve a
 * poder consultar) — por eso se bloquea el formulario con esa pantalla de "copiá esto" hasta
 * que el SUPER_ADMIN confirma haberla guardado/compartido.
 */
function NewComplexForm({ onCreated }: { onCreated: (complex: Complex) => void }) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ComplexCreationResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<ComplexCreationResult>('/complexes', {
        name,
        city: city || undefined,
        address: address || undefined,
        adminEmail,
        adminFirstName,
        adminLastName,
      });
      setCreated(res);
    } catch (err) {
      setError(errorMessage(err, 'No pudimos crear el complejo'));
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <div className="mb-3 space-y-2 rounded-lg border border-pitch-500/40 bg-pitch-500/10 p-3 text-xs">
        <p className="font-semibold text-pitch-300">✅ Complejo creado. Datos del administrador:</p>
        <p className="text-ink-200">
          Email: <span className="font-mono">{created.admin.email}</span>
        </p>
        <p className="text-ink-200">
          Contraseña temporal: <span className="font-mono text-sm text-pitch-300">{created.adminTempPassword}</span>
        </p>
        <p className="text-ink-400">
          Copiá esta contraseña ahora y pasásela al dueño del complejo por fuera del sistema — no se vuelve a mostrar. Puede cambiarla
          después desde su perfil.
        </p>
        <button
          className="btn-primary w-full !py-1.5 text-xs"
          onClick={() => {
            const complex = created.complex;
            setCreated(null);
            setName('');
            setCity('');
            setAddress('');
            setAdminEmail('');
            setAdminFirstName('');
            setAdminLastName('');
            onCreated(complex);
          }}
        >
          Ya la guardé
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mb-3 space-y-2 rounded-lg bg-ink-800/40 p-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <input required className="input-field" placeholder="Nombre del complejo" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input-field" placeholder="Ciudad" value={city} onChange={(e) => setCity(e.target.value)} />
      <input className="input-field" placeholder="Dirección" value={address} onChange={(e) => setAddress(e.target.value)} />
      <div className="border-t border-ink-700 pt-2">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Administrador del complejo</p>
        <input
          required
          type="email"
          className="input-field"
          placeholder="Email del administrador"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input required className="input-field" placeholder="Nombre" value={adminFirstName} onChange={(e) => setAdminFirstName(e.target.value)} />
          <input required className="input-field" placeholder="Apellido" value={adminLastName} onChange={(e) => setAdminLastName(e.target.value)} />
        </div>
      </div>
      <button type="submit" disabled={saving} className="btn-primary w-full">
        {saving ? 'Creando...' : 'Crear complejo'}
      </button>
    </form>
  );
}

/**
 * Historial de pases de acceso a videos vendidos por un complejo (2026-10-16) — el admin del
 * complejo necesita poder ver quién pagó, cuánto y cuándo, no solo si Mercado Pago está
 * conectado (eso ya lo muestra `VideoAccessSettingsCard`). Filtra por fecha de creación del pase
 * (no de pago) para que también se vean los intentos pendientes/rechazados del período, no solo
 * los cobrados — ver el comentario en `MercadopagoService.listPasses`.
 */
function VideoAccessPaymentsCard({ complexId }: { complexId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<VideoAccessPassesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const STATUS_LABELS: Record<string, string> = { PENDING: 'Pendiente', APPROVED: 'Pagado', REJECTED: 'Rechazado', EXPIRED: 'Vencido' };
  const STATUS_CLASSES: Record<string, string> = {
    PENDING: 'bg-amber-500/15 text-amber-400',
    APPROVED: 'bg-pitch-500/15 text-pitch-400',
    REJECTED: 'bg-red-500/15 text-red-400',
    EXPIRED: 'bg-ink-700/60 text-ink-300',
  };

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const res = await api.get<VideoAccessPassesResponse>(`/complexes/${complexId}/video-access/payments${qs ? `?${qs}` : ''}`);
      setData(res);
    } catch (err) {
      setError(errorMessage(err, 'No pudimos cargar los pagos de este complejo'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    load();
  }, [complexId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card space-y-4 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-300">Pagos por acceso a videos</h3>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-400">
          Desde
          <input type="date" className="input-field mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-ink-400">
          Hasta
          <input type="date" className="input-field mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn-secondary !py-1.5 text-xs" onClick={load} disabled={loading}>
          {loading ? 'Buscando...' : 'Filtrar'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {!data && !error && <p className="text-xs text-ink-400">Cargando...</p>}

      {data && (
        <>
          <p className="text-sm text-white">
            Total pagado en el período:{' '}
            <span className="font-semibold text-pitch-400">${data.totalApprovedArs.toLocaleString('es-AR')}</span>
          </p>
          {data.passes.length === 0 ? (
            <p className="text-xs text-ink-400">No hay pases en este período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ink-400">
                    <th className="pb-2 pr-3 font-medium">Fecha</th>
                    <th className="pb-2 pr-3 font-medium">Usuario</th>
                    <th className="pb-2 pr-3 font-medium">Monto</th>
                    <th className="pb-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.passes.map((p) => (
                    <tr key={p.id} className="border-t border-ink-800">
                      <td className="py-2 pr-3 text-ink-300">{new Date(p.createdAt).toLocaleDateString('es-AR')}</td>
                      <td className="py-2 pr-3 text-ink-300">{p.user ? `${p.user.firstName} ${p.user.lastName}` : '—'}</td>
                      <td className="py-2 pr-3 text-ink-300">${p.amountArs.toLocaleString('es-AR')}</td>
                      <td className="py-2">
                        <span className={clsx('badge', STATUS_CLASSES[p.status] ?? 'bg-ink-700/60 text-ink-300')}>
                          {STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Editor reutilizado para configurar el horario fijo de turnos de una cancha (días abiertos,
 * primer/último turno, duración) — lo usan tanto el alta de cancha nueva como la edición de
 * una ya existente. Es lo que dispara la generación automática de partidos por turno en el
 * backend (ver `MatchSchedulerService`): sin esto, ninguna cancha graba nada, porque ya no
 * existe una pantalla para "cargar" partidos uno por uno a mano.
 */
function TurnScheduleEditor({
  openDays,
  onToggleDay,
  turnStart,
  onTurnStart,
  turnEnd,
  onTurnEnd,
  turnDurationMinutes,
  onTurnDurationMinutes,
}: {
  openDays: number[];
  onToggleDay: (iso: number) => void;
  turnStart: string;
  onTurnStart: (v: string) => void;
  turnEnd: string;
  onTurnEnd: (v: string) => void;
  turnDurationMinutes: number;
  onTurnDurationMinutes: (v: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg bg-ink-900/40 p-3">
      <div>
        <label className="label-field">Días con turnos</label>
        <div className="flex flex-wrap gap-1.5">
          {WEEK_DAYS.map((d) => (
            <button
              key={d.iso}
              type="button"
              onClick={() => onToggleDay(d.iso)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs font-semibold transition',
                openDays.includes(d.iso) ? 'bg-pitch-500 text-white' : 'bg-ink-800 text-ink-400 hover:text-ink-200',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label-field">Primer turno</label>
          <input type="time" className="input-field" value={turnStart} onChange={(e) => onTurnStart(e.target.value)} />
        </div>
        <div>
          <label className="label-field">Último turno (inicio)</label>
          <input type="time" className="input-field" value={turnEnd} onChange={(e) => onTurnEnd(e.target.value)} />
        </div>
        <div>
          <label className="label-field">Duración del turno (min)</label>
          <input
            type="number"
            min={15}
            step={5}
            className="input-field"
            value={turnDurationMinutes}
            onChange={(e) => onTurnDurationMinutes(Number(e.target.value) || 0)}
          />
        </div>
      </div>
      <p className="text-xs text-ink-500">
        La cámara graba todo el tiempo igual; esto solo define qué turnos aparecen como partidos para buscar y cuándo el agente local sabe
        qué recortar. Se generan siempre los próximos 14 días.
      </p>
    </div>
  );
}

function useTurnSchedule(initial?: CourtOperatingHours | null, sportType?: SportType) {
  const [openDays, setOpenDaysState] = useState<number[]>(initial?.openDays ?? [1, 2, 3, 4, 5, 6, 7]);
  const [turnStart, setTurnStart] = useState(initial?.turnStart ?? '08:00');
  const [turnEnd, setTurnEnd] = useState(initial?.turnEnd ?? '23:00');
  const [turnDurationMinutes, setTurnDurationMinutes] = useState(
    initial?.turnDurationMinutes ?? DEFAULT_TURN_MINUTES[sportType ?? 'FUTBOL5'],
  );

  function toggleDay(iso: number) {
    setOpenDaysState((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()));
  }

  const value: CourtOperatingHours = { openDays, turnStart, turnEnd, turnDurationMinutes };
  return { openDays, toggleDay, turnStart, setTurnStart, turnEnd, setTurnEnd, turnDurationMinutes, setTurnDurationMinutes, value };
}

function NewCourtForm({ complexId, onCreated }: { complexId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [sportType, setSportType] = useState<SportType>('FUTBOL5');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schedule = useTurnSchedule(null, sportType);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/courts', { complexId, name, sportType, location: location || undefined, operatingHours: schedule.value });
      setName('');
      setLocation('');
      onCreated();
    } catch (err) {
      setError(errorMessage(err, 'No pudimos crear la cancha'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr]">
        <div>
          <label className="label-field">Nombre</label>
          <input required className="input-field" placeholder="Cancha 1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label-field">Deporte</label>
          <select
            className="input-field"
            value={sportType}
            onChange={(e) => {
              const next = e.target.value as SportType;
              setSportType(next);
              schedule.setTurnDurationMinutes(DEFAULT_TURN_MINUTES[next]);
            }}
          >
            {Object.entries(SPORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-field">Ubicación (opcional)</label>
          <input className="input-field" placeholder="Sector techado, planta baja..." value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      <TurnScheduleEditor
        openDays={schedule.openDays}
        onToggleDay={schedule.toggleDay}
        turnStart={schedule.turnStart}
        onTurnStart={schedule.setTurnStart}
        turnEnd={schedule.turnEnd}
        onTurnEnd={schedule.setTurnEnd}
        turnDurationMinutes={schedule.turnDurationMinutes}
        onTurnDurationMinutes={schedule.setTurnDurationMinutes}
      />

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? 'Creando...' : 'Crear cancha'}
      </button>
    </form>
  );
}

function CourtCard({
  court,
  imouDevices,
  imouDevicesError,
  loadingImouDevices,
  ensureImouDevices,
  onChanged,
}: {
  court: Court;
  imouDevices: ImouDevice[] | null;
  imouDevicesError: string | null;
  loadingImouDevices: boolean;
  ensureImouDevices: () => void;
  onChanged: () => void;
}) {
  const [showCameraForm, setShowCameraForm] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(court.name);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setSavingName(true);
    setNameError(null);
    try {
      await api.patch(`/courts/${court.id}`, { name: trimmed });
      setEditingName(false);
      onChanged();
    } catch (err) {
      setNameError(errorMessage(err, 'No pudimos renombrar la cancha'));
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {editingName ? (
            <form className="flex flex-wrap items-center gap-2" onSubmit={onSaveName}>
              <input
                autoFocus
                className="input-field w-40 text-sm"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
              />
              <button type="submit" disabled={savingName} className="text-xs font-semibold text-pitch-400 hover:text-pitch-300 disabled:opacity-60">
                {savingName ? 'Guardando...' : 'Guardar'}
              </button>
              <button
                type="button"
                className="text-xs text-ink-400 hover:text-ink-200"
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(court.name);
                  setNameError(null);
                }}
              >
                Cancelar
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white">{court.name}</h3>
              <button className="text-xs text-ink-400 hover:text-ink-200" onClick={() => setEditingName(true)} title="Editar nombre">
                ✏️
              </button>
            </div>
          )}
          <p className="text-xs text-ink-400">{SPORT_LABELS[court.sportType] ?? court.sportType}</p>
          {nameError && <p className="mt-1 text-xs text-red-400">{nameError}</p>}
        </div>
        <StatusBadge status={court.status} />
      </div>

      <div className="mt-4 border-t border-ink-800 pt-4">
        {showScheduleForm ? (
          <ScheduleForm court={court} onSaved={() => { setShowScheduleForm(false); onChanged(); }} onCancel={() => setShowScheduleForm(false)} />
        ) : court.operatingHours ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-ink-300">
              ⏱ {court.operatingHours.openDays.length === 7 ? 'Todos los días' : `${court.operatingHours.openDays.length} días/semana`} ·{' '}
              {court.operatingHours.turnStart}–{court.operatingHours.turnEnd} · turnos de {court.operatingHours.turnDurationMinutes} min
            </p>
            <button className="text-xs font-semibold text-pitch-400 hover:text-pitch-300" onClick={() => setShowScheduleForm(true)}>
              ✏️ Editar horario
            </button>
          </div>
        ) : (
          <button className="btn-secondary text-sm" onClick={() => setShowScheduleForm(true)}>
            ⏱ Configurar horario de turnos
          </button>
        )}
      </div>

      <div className="mt-4 border-t border-ink-800 pt-4">
        {court.camera ? (
          <CameraSummary camera={court.camera} onDeleted={onChanged} />
        ) : showCameraForm ? (
          <AddCameraForm
            courtId={court.id}
            imouDevices={imouDevices}
            imouDevicesError={imouDevicesError}
            loadingImouDevices={loadingImouDevices}
            ensureImouDevices={ensureImouDevices}
            onCreated={() => {
              setShowCameraForm(false);
              onChanged();
            }}
            onCancel={() => setShowCameraForm(false)}
          />
        ) : (
          <button className="btn-secondary text-sm" onClick={() => setShowCameraForm(true)}>
            📷 Agregar cámara
          </button>
        )}
      </div>
    </div>
  );
}

function ScheduleForm({ court, onSaved, onCancel }: { court: Court; onSaved: () => void; onCancel: () => void }) {
  const schedule = useTurnSchedule(court.operatingHours, court.sportType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/courts/${court.id}`, { operatingHours: schedule.value });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'No pudimos guardar el horario'));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <TurnScheduleEditor
        openDays={schedule.openDays}
        onToggleDay={schedule.toggleDay}
        turnStart={schedule.turnStart}
        onTurnStart={schedule.setTurnStart}
        turnEnd={schedule.turnEnd}
        onTurnEnd={schedule.setTurnEnd}
        turnDurationMinutes={schedule.turnDurationMinutes}
        onTurnDurationMinutes={schedule.setTurnDurationMinutes}
      />
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Guardando...' : 'Guardar horario'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function CameraSummary({ camera, onDeleted }: { camera: Camera; onDeleted: () => void }) {
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{ code: string; expiresAt: string } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Cuenta regresiva del código (vence a los 10 min del lado del backend) — puramente visual,
  // para que quien está parado frente al TV box sepa si todavía llega a tipearlo o mejor genera
  // uno nuevo. El backend es la única fuente de verdad real sobre si el código sigue valiendo.
  useEffect(() => {
    if (!enrollment) {
      setSecondsLeft(null);
      return;
    }
    const expiresAt = new Date(enrollment.expiresAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [enrollment]);

  async function onGenerateEnrollmentCode() {
    setEnrolling(true);
    setEnrollError(null);
    try {
      const res = await api.post<{ code: string; expiresAt: string }>(`/cameras/${camera.id}/enrollment-code`, {});
      setEnrollment(res);
    } catch (err) {
      setEnrollError(errorMessage(err, 'No pudimos generar el código'));
    } finally {
      setEnrolling(false);
    }
  }

  async function onTestLive() {
    setTesting(true);
    setTestError(null);
    setLiveUrl(null);
    try {
      const res = await api.get<{ url: string }>(`/cameras/${camera.id}/imou/live-url`);
      setLiveUrl(res.url);
    } catch (err) {
      setTestError(errorMessage(err, 'No pudimos obtener la URL en vivo'));
    } finally {
      setTesting(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`¿Eliminar la cámara "${camera.name}"? Vas a poder vincular una nueva para esta cancha.`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/cameras/${camera.id}`);
      onDeleted();
    } catch (err) {
      setDeleteError(errorMessage(err, 'No pudimos eliminar la cámara'));
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="text-sm">
        <p className="font-medium text-white">
          {camera.name} <span className="ml-1 text-xs font-normal text-ink-400">· {CAMERA_TYPE_LABELS[camera.type] ?? camera.type}</span>
        </p>
        <div className="mt-1">
          <StatusBadge status={camera.status} />
        </div>
        {camera.type === 'IMOU_CLOUD' && (
          <p className="mt-1 text-xs text-ink-400">
            Dispositivo {camera.imouDeviceId} · canal {camera.imouChannelId ?? '0'}
          </p>
        )}
        {camera.rtspUrl && <p className="mt-1 truncate text-xs text-ink-400">{camera.rtspUrl}</p>}
        {deleteError && <p className="mt-1 text-xs text-red-400">{deleteError}</p>}
      </div>

      <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
        {camera.type === 'IMOU_CLOUD' && (
          <div>
            <button className="btn-secondary text-sm" onClick={onTestLive} disabled={testing}>
              {testing ? 'Consultando...' : '▶ Probar en vivo'}
            </button>
            {testError && <p className="mt-2 text-xs text-red-400">{testError}</p>}
            {liveUrl && (
              <div className="mt-2 max-w-sm rounded-lg bg-ink-800/60 p-2 text-xs text-ink-300">
                <p className="mb-1 text-ink-400">URL HLS (abrila en VLC u otro reproductor):</p>
                <p className="break-all font-mono text-pitch-400">{liveUrl}</p>
              </div>
            )}
          </div>
        )}
        {camera.type !== 'IMOU_CLOUD' && (
          <div>
            <button className="btn-secondary text-sm" onClick={onGenerateEnrollmentCode} disabled={enrolling}>
              {enrolling ? 'Generando...' : '🔑 Generar código de instalación'}
            </button>
            {enrollError && <p className="mt-2 text-xs text-red-400">{enrollError}</p>}
            {enrollment && secondsLeft !== null && (
              <div className="mt-2 max-w-xs rounded-lg bg-ink-800/60 p-3 text-xs text-ink-300">
                {secondsLeft > 0 ? (
                  <>
                    <p className="mb-1 text-ink-400">
                      Ingresá este código en la pantalla de instalación del TV box (vence en{' '}
                      {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}):
                    </p>
                    <p className="text-center text-2xl font-bold tracking-widest text-pitch-400">{enrollment.code}</p>
                  </>
                ) : (
                  <p className="text-red-400">El código venció — generá uno nuevo.</p>
                )}
              </div>
            )}
          </div>
        )}
        <button
          className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-60"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? 'Eliminando...' : '🗑 Eliminar cámara'}
        </button>
      </div>
    </div>
  );
}

function AddCameraForm({
  courtId,
  imouDevices,
  imouDevicesError,
  loadingImouDevices,
  ensureImouDevices,
  onCreated,
  onCancel,
}: {
  courtId: string;
  imouDevices: ImouDevice[] | null;
  imouDevicesError: string | null;
  loadingImouDevices: boolean;
  ensureImouDevices: () => void;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'IMOU_CLOUD' | 'GENERIC'>('IMOU_CLOUD');

  useEffect(() => {
    if (mode === 'IMOU_CLOUD') ensureImouDevices();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-lg bg-ink-800/40 p-4">
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setMode('IMOU_CLOUD')}
          className={clsx('rounded-lg px-3 py-1.5 text-xs font-semibold', mode === 'IMOU_CLOUD' ? 'bg-pitch-500 text-white' : 'bg-ink-800 text-ink-300')}
        >
          Imou Cloud
        </button>
        <button
          type="button"
          onClick={() => setMode('GENERIC')}
          className={clsx('rounded-lg px-3 py-1.5 text-xs font-semibold', mode === 'GENERIC' ? 'bg-pitch-500 text-white' : 'bg-ink-800 text-ink-300')}
        >
          RTSP / IP / NVR / DVR
        </button>
      </div>

      {mode === 'IMOU_CLOUD' ? (
        <ImouCameraForm
          courtId={courtId}
          devices={imouDevices}
          devicesError={imouDevicesError}
          loadingDevices={loadingImouDevices}
          onCreated={onCreated}
          onCancel={onCancel}
        />
      ) : (
        <GenericCameraForm courtId={courtId} onCreated={onCreated} onCancel={onCancel} />
      )}
    </div>
  );
}

function ImouCameraForm({
  courtId,
  devices,
  devicesError,
  loadingDevices,
  onCreated,
  onCancel,
}: {
  courtId: string;
  devices: ImouDevice[] | null;
  devicesError: string | null;
  loadingDevices: boolean;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [deviceId, setDeviceId] = useState('');
  const [channelId, setChannelId] = useState('0');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDevice = devices?.find((d) => d.deviceId === deviceId) ?? null;

  useEffect(() => {
    if (!deviceId && devices && devices.length > 0) {
      setDeviceId(devices[0].deviceId);
      setChannelId(devices[0].channels?.[0]?.channelId ?? '0');
    }
  }, [devices]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/cameras/imou', { courtId, name, deviceId, channelId, code: code || undefined });
      onCreated();
    } catch (err) {
      setError(errorMessage(err, 'No pudimos vincular la cámara con Imou'));
    } finally {
      setSaving(false);
    }
  }

  if (loadingDevices) return <p className="text-sm text-ink-400">Consultando dispositivos en Imou...</p>;
  if (devicesError) return <p className="text-sm text-red-400">{devicesError}</p>;
  if (devices && devices.length === 0) {
    return (
      <p className="text-sm text-ink-400">
        Imou no tiene ningún dispositivo vinculado a nuestra app todavía. Hay que emparejarlo primero desde la app Imou Life.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label-field">Dispositivo Imou</label>
          <select
            className="input-field"
            value={deviceId}
            onChange={(e) => {
              const d = devices?.find((x) => x.deviceId === e.target.value);
              setDeviceId(e.target.value);
              setChannelId(d?.channels?.[0]?.channelId ?? '0');
            }}
          >
            {devices?.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.deviceId}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-field">Canal</label>
          <select className="input-field" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {(selectedDevice?.channels ?? [{ channelId: '0', channelName: 'Canal 0' }]).map((ch) => (
              <option key={ch.channelId} value={ch.channelId}>
                {ch.channelName || `Canal ${ch.channelId}`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label-field">Nombre de la cámara</label>
        <input required className="input-field" placeholder="Camara cancha 1" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label-field">Código / contraseña del dispositivo (opcional)</label>
        <input className="input-field" placeholder="Solo si el dispositivo lo pide" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving || !deviceId} className="btn-primary">
          {saving ? 'Vinculando...' : 'Vincular cámara'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function GenericCameraForm({ courtId, onCreated, onCancel }: { courtId: string; onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CameraType>('RTSP');
  const [rtspUrl, setRtspUrl] = useState('');
  const [nvrChannel, setNvrChannel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsRtsp = type === 'RTSP' || type === 'IP_CAMERA';
  const needsNvrChannel = type === 'NVR' || type === 'DVR';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/cameras', {
        courtId,
        name,
        type,
        status: 'UNKNOWN',
        rtspUrl: needsRtsp && rtspUrl ? rtspUrl : undefined,
        nvrChannel: needsNvrChannel && nvrChannel ? Number(nvrChannel) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err, 'No pudimos crear la cámara'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label-field">Nombre</label>
          <input required className="input-field" placeholder="Camara cancha 2" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label-field">Tipo</label>
          <select className="input-field" value={type} onChange={(e) => setType(e.target.value as CameraType)}>
            {(['RTSP', 'IP_CAMERA', 'NVR', 'DVR'] as CameraType[]).map((t) => (
              <option key={t} value={t}>
                {CAMERA_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {needsRtsp && (
        <div>
          <label className="label-field">URL RTSP</label>
          <input
            className="input-field"
            placeholder="rtsp://usuario:clave@192.168.1.50:554/stream1"
            value={rtspUrl}
            onChange={(e) => setRtspUrl(e.target.value)}
          />
        </div>
      )}
      {needsNvrChannel && (
        <div>
          <label className="label-field">Canal de NVR/DVR</label>
          <input
            type="number"
            min={0}
            className="input-field"
            placeholder="1"
            value={nvrChannel}
            onChange={(e) => setNvrChannel(e.target.value)}
          />
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Creando...' : 'Crear cámara'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </form>
  );
}
