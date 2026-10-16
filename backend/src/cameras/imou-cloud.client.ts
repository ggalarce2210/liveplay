import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Cliente HTTP para el Imou Open Platform (antes "Easy4ip Open Platform" - Dahua discontinuo
 * ese dominio propio y unifico todo bajo la marca Imou; `open.easy4ip.com` hoy redirige a
 * `open.imoulife.com`). Es la via oficial para leer, desde nuestro backend, camaras que viven
 * en la cuenta cloud de un usuario (wifi, sin acceso RTSP directo) - Dahua o Imou por igual,
 * siempre que el dispositivo este dado de alta bajo ese paraguas (ver nota en `bindDevice`).
 *
 * Documentacion consultada el 2026-09-13 en https://open.imoulife.com/book/en (logueado como
 * developer): Development Specification (firma), accessToken, deviceBaseList, bindDevice,
 * checkDeviceBindOrNot, bindDeviceLive, getLiveStreamInfo.
 *
 * Validado contra la API real el 2026-09-14 con una camara Imou de prueba (data center "or",
 * Western America). Dos comportamientos NO documentados con claridad que aparecieron recien ahi
 * y que este cliente ya contempla:
 *  - `bindDevice` no es idempotente: si el dispositivo ya esta vinculado a nuestra app, tira un
 *    error (codigo OP1002) en vez de no hacer nada. Por eso ahora consultamos primero con
 *    `checkDeviceBindOrNot`.
 *  - `bindDeviceLive` tampoco lo es: si ya hay una sesion de streaming activa para ese canal,
 *    tira error LV1001 en vez de devolver la URL existente. Ahi hay que recurrir a
 *    `getLiveStreamInfo`, que ademas es el unico metodo que devuelve la variante https (
 *    `bindDeviceLive` solo devuelve la http, y nuestro frontend corre en https - sin esto el
 *    navegador bloquearia el stream por contenido mixto).
 */

interface ImouEnvelope<T> {
  result: { code: string; msg: string; data?: T };
  id: string;
}

interface ImouDeviceChannel {
  channelId: string;
  channelName: string;
}

interface ImouDevice {
  bindId: number;
  deviceId: string;
  channels: ImouDeviceChannel[];
}

interface ImouLiveStream {
  streamId: number;
  hls: string;
  liveToken?: string;
}

/** Error de la API de Imou con el codigo original (p.ej. "LV1001") disponible para los llamadores. */
class ImouApiError extends BadGatewayException {
  constructor(
    readonly imouCode: string,
    method: string,
    msg: string,
  ) {
    super(`Imou Open Platform: ${method} devolvio ${imouCode} (${msg})`);
  }
}

@Injectable()
export class ImouCloudClient {
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly appSecret: string;
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    // Data center donde vive la cuenta de developer: se ve en Consola -> My Information.
    // sg = East Asia, fk = Central Europe, or = Western America.
    const dataCenter = this.config.get<string>('IMOU_DATA_CENTER', 'sg');
    this.baseUrl = `https://openapi-${dataCenter}.easy4ip.com/openapi`;
    this.appId = this.config.get<string>('IMOU_APP_ID', '');
    this.appSecret = this.config.get<string>('IMOU_APP_SECRET', '');
  }

  /**
   * Firma cada request segun la "Development Specification" del open platform:
   *   password = LowerCase(Hex(SHA-256(appSecret)))
   *   sign     = Base64(HMAC-SHA256("time:{time},nonce:{nonce},appSecret:{appSecret}", password))
   * Verificado offline contra el caso de test oficial de la documentacion (time=1706511734,
   * nonce=f5a1ae2d-c09c-4d39-a744-83a5c2c653c2, appSecret=test123456789test123456789 ->
   * sign=xjhCQBoJ9hRDsCjyDcHjtDNzRZ3ZJezcawsfWeiaoxU=) antes de usarla contra la API real.
   */
  private sign(time: number, nonce: string): string {
    const password = crypto.createHash('sha256').update(this.appSecret).digest('hex').toLowerCase();
    const source = `time:${time},nonce:${nonce},appSecret:${this.appSecret}`;
    return crypto.createHmac('sha256', password).update(source).digest('base64');
  }

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const time = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    const body = {
      system: { ver: '1.0', appId: this.appId, sign: this.sign(time, nonce), time, nonce },
      id: crypto.randomUUID(),
      params,
    };

    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as ImouEnvelope<T>;
    if (json.result?.code !== '0') {
      throw new ImouApiError(json.result?.code, method, json.result?.msg);
    }
    return (json.result.data ?? ({} as T)) as T;
  }

  /**
   * El accessToken de administrador dura 3 dias (documentado). Lo cacheamos en memoria del
   * proceso y lo renovamos con 5 minutos de margen - la doc pide explicitamente no pedirlo en
   * cada llamada para no gastar cuota de la API.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 5 * 60_000) {
      return this.cachedToken.accessToken;
    }
    const data = await this.call<{ accessToken: string; expireTime: number }>('accessToken', {});
    this.cachedToken = { accessToken: data.accessToken, expiresAt: now + data.expireTime * 1000 };
    return this.cachedToken.accessToken;
  }

  private async callAuthed<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const token = await this.getAccessToken();
    return this.call<T>(method, { ...params, token });
  }

  /** Lista los dispositivos/canales ya vinculados o compartidos a nuestra aplicacion. */
  async listDevices(limit = 50): Promise<ImouDevice[]> {
    const data = await this.callAuthed<{ count: number; deviceList: ImouDevice[] }>('deviceBaseList', {
      bindId: -1,
      limit,
      type: 'bindAndShare',
      needApInfo: false,
    });
    return data.deviceList ?? [];
  }

  /** Consulta si un dispositivo ya esta vinculado a una cuenta, y si esa cuenta es la nuestra. */
  async isDeviceBound(deviceId: string): Promise<{ isBind: boolean; isMine: boolean }> {
    return this.callAuthed<{ isBind: boolean; isMine: boolean }>('checkDeviceBindOrNot', { deviceId });
  }

  /**
   * Vincula un dispositivo nuevo a nuestra app. `code` es la contrasena del dispositivo (si
   * tiene autenticacion habilitada) o el codigo de 6 digitos impreso en la etiqueta/QR fisico -
   * se puede dejar vacio si el dispositivo no tiene ninguno de los dos.
   *
   * Importante: esto NO "descubre" camaras - el `deviceId` tiene que existir ya en el
   * directorio de Imou/easy4ip. Una camara Dahua dada de alta unicamente por la app DMSS puede
   * no existir ahi (mismo P2P por debajo, pero cuentas/directorios separados) - hay que
   * emparejarla primero desde la app Imou Life para que este metodo la encuentre.
   *
   * `bindDevice` no es idempotente (tira error OP1002 si el dispositivo ya es nuestro), asi que
   * primero consultamos `checkDeviceBindOrNot` y solo llamamos a `bindDevice` si hace falta.
   */
  async bindDevice(deviceId: string, code: string): Promise<void> {
    const status = await this.isDeviceBound(deviceId);
    if (status.isBind) {
      if (!status.isMine) {
        throw new BadGatewayException(
          `El dispositivo ${deviceId} ya esta vinculado a otra cuenta de Imou, no a la nuestra.`,
        );
      }
      return; // ya es nuestro, no hace falta (ni se puede) re-vincularlo.
    }
    await this.callAuthed<void>('bindDevice', { deviceId, code: code ?? '' });
  }

  /**
   * Crea (o reutiliza, si ya estaba activa) la sesion de streaming en vivo de un canal y
   * devuelve su URL HLS en https. streamId 1 = SD (mas liviano), 0 = HD.
   *
   * `bindDeviceLive` no es idempotente (tira error LV1001 si ya habia una sesion activa) y ademas
   * solo devuelve la variante http de la URL. Por eso, tanto si la sesion es nueva como si ya
   * existia, la URL final se obtiene siempre de `getLiveStreamInfo` - que lista las 4 variantes
   * (HD/SD x http/https) - para poder preferir https y evitar el bloqueo por contenido mixto en
   * el frontend (que corre en https).
   */
  async getLiveHlsUrl(deviceId: string, channelId: string, streamId: 0 | 1 = 1): Promise<string> {
    try {
      await this.callAuthed<{ streams: ImouLiveStream[] }>('bindDeviceLive', { deviceId, channelId, streamId });
    } catch (e) {
      const alreadyLive = e instanceof ImouApiError && e.imouCode === 'LV1001';
      if (!alreadyLive) {
        throw e;
      }
      // LV1001: ya hay una sesion en curso para este canal - getLiveStreamInfo la va a encontrar.
    }

    const info = await this.callAuthed<{ streams: ImouLiveStream[] }>('getLiveStreamInfo', { deviceId, channelId });
    const streams = info.streams ?? [];
    const https = streams.find((s) => s.streamId === streamId && s.hls?.startsWith('https://'));
    const http = streams.find((s) => s.streamId === streamId && s.hls?.startsWith('http://'));
    const stream = https ?? http ?? streams[0];
    if (!stream?.hls) {
      throw new BadGatewayException('Imou no devolvio una URL de streaming en vivo para esta camara.');
    }
    return stream.hls;
  }
}
