import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

/**
 * Arma la URL publica /stream/:token para una key de storage, sin importar que driver
 * este activo (LOCAL o S3/R2).
 *
 * Por que existe: StorageDriver.getSignedReadUrl() significa cosas distintas segun el driver
 * - en LocalDiskStorageDriver siempre devuelve un link a nuestro propio /api/stream/:token
 * (porque no hay otro lugar de donde servir el archivo), pero en S3StorageDriver devuelve una
 * URL firmada DIRECTA al bucket (necesario para que StreamController pueda redirigir ahi los
 * segmentos .ts, que son el peso real del video). El problema es que un manifest .m3u8 o un
 * .vtt de miniaturas necesitan reescritura (sus referencias relativas a segmentos/sprite deben
 * convertirse en URLs firmadas propias - ver StreamController.rewriteManifestOrVtt) y esa
 * reescritura SOLO pasa cuando el request entra por /api/stream/:token. Si el "primer" link
 * que le damos al cliente para el manifest es ya la URL directa de S3 (bypaseando el proxy), el
 * manifest llega sin reescribir - con nombres de archivo relativos sin firmar - y el
 * reproductor no puede resolver ningun segmento (S25 ademas exige no exponer nunca la key real).
 *
 * Por eso: para todo lo que el cliente pide como punto de entrada (el manifest de un video, el
 * vtt de miniaturas, el manifest de un share link), usar SIEMPRE este servicio en vez de
 * storage.getSignedReadUrl() - asi el request pasa por StreamController pase lo que pase el
 * driver activo. storage.getSignedReadUrl() queda reservado para lo que StreamController usa
 * internamente (redirigir un segmento individual al bucket) y para archivos sueltos que no
 * necesitan reescritura (ej. un clip ya renderizado a un unico .mp4).
 *
 * Bug real encontrado el 2026-10-21 (mismo patron que en StreamController.rewriteManifestOrVtt):
 * esta funcion agregaba su propio "/api/stream/..." a mano sobre `API_PUBLIC_URL`. Eso fue
 * correcto mientras `API_PUBLIC_URL` en Render apuntaba solo al host (sin "/api"). El
 * 2026-10-20 se corrigio `API_PUBLIC_URL` para que SI incluya el sufijo "/api" (necesario para
 * el agente local, ver agent-enroll.controller.ts) - pero esta funcion seguia agregando su
 * propio "/api/" encima, resultando en URLs "/api/api/stream/..." (404 siempre). Esto rompio
 * la carga del manifest/thumbnails de TODOS los partidos de la plataforma apenas se aplico el
 * fix de `API_PUBLIC_URL`, ya que esta es la funcion que arma el link "de entrada" que recibe
 * el navegador (ver matches.service.ts / share.controller.ts). Fix: `API_PUBLIC_URL` ya trae
 * el prefijo "/api" puesto, asi que alcanza con `${publicBaseUrl}/stream/...` (sin agregarlo
 * de nuevo).
 */
@Injectable()
export class StreamTokenService {
  constructor(private config: ConfigService) {}

  sign(key: string, expiresInSeconds: number): string {
    const secret = this.config.get<string>('VIDEO_URL_SIGNING_SECRET', 'dev-secret-change-me');
    const publicBaseUrl = this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001/api');
    const token = jwt.sign({ key }, secret, { expiresIn: expiresInSeconds });
    return `${publicBaseUrl}/stream/${encodeURIComponent(token)}`;
  }
}
