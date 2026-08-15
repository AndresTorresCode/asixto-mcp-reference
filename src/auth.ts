import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server';

/**
 * NIVEL 2 del contrato · token rotable (mínimo aceptable).
 *
 * Un token opaco emitido por usted, con caducidad declarada y rotación sin intervención de
 * Asixto. El middleware del SDK se encarga del 401 con `WWW-Authenticate`, que es lo que la
 * certificación verifica.
 *
 * Para el NIVEL 1 (recomendado, OAuth 2.1 con credenciales de cliente) sustituya este
 * verificador por la introspección de su servidor de autorización y publique los metadatos de
 * recurso protegido con `mcpAuthMetadataRouter`. La interfaz que consume el servidor es la
 * misma: `verifyAccessToken`.
 */
export function verificadorDeTokens(tokensValidos: string[]): OAuthTokenVerifier {
  const validos = new Set(tokensValidos.filter(Boolean));

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (!validos.has(token)) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token desconocido o revocado');
      }

      return {
        token,
        clientId: 'asixto-gateway',
        scopes: ['mcp:tools'],
        // El SDK RECHAZA tokens sin caducidad. Aquí es una hora deslizante; en producción
        // devuelva el `exp` real de su token.
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    },
  };
}
